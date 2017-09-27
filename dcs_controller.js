/*
* Copyright (c) 2017 Baidu, Inc. All Rights Reserved.
* 
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
* 
*   http://www.apache.org/licenses/LICENSE-2.0
* 
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/
const util = require('util');
const EventEmitter=require("events");
const DcsProtocol=require("./dcs_protocol");
const DataStreamPlayer=require("./data_stream_player");
const AudioPlayerManager=require("./audio_player_manager");
const SpeakerManager=require("./speaker_manager");
const AlertManager=require("./alert_manager");
const VoiceInputManager=require("./voice_input_manager");
const VoiceOutputManager=require("./voice_output_manager");
const HttpManager=require("./http_manager");
const LocationManager=require("./location_manager");
const ScreenManager=require("./screen_manager");
const configModule=require("./config.js");
const config=configModule.getAll();
const directive_handlers={
    /*
     *
{
  "directive": {
    "header": {
      "namespace": "SpeechSynthesizer",
      "name": "Speak",
      "dialogRequestId": "string",
      "messageId": "string"
    },
    "payload": {
      "format": "AUDIO_MPEG",
      "token": "1495556956_13665vo42",
      "url": "cid:97"
    }
  }
}
    "ai.dueros.device_interface.image_recognition":function(directive){
        var _event=DcsProtocol.createEvent("ai.dueros.device_interface.image_recognition","StartUploadScreenShot",this.getContext(),
            {
                "token":"1502376005",
                "type":"face",
                "url":"http://b.hiphotos.baidu.com/xiaodu/pic/item/f9198618367adab4db715da581d4b31c8601e4b7.jpg"
            });
        this.emit("event",_event);
        return true;
    },
     */
    "ai.dueros.device_interface.http":function(directive){
        return this.httpManager.handleDirective(directive,this);
    },
    "ai.dueros.device_interface.screen":function(directive){
        return this.screenManager.handleDirective(directive,this);
    },
    "ai.dueros.device_interface.location":function(directive){
        return this.locationManager.handleDirective(directive,this);
    },
    "ai.dueros.device_interface.alerts":function(directive){
        return this.alertManager.handleDirective(directive,this);
    },
    "ai.dueros.device_interface.voice_input":function(directive){
        return this.voiceInputManager.handleDirective(directive,this);
    },
    "ai.dueros.device_interface.voice_output":function(directive){
        return this.voiceOutputManager.handleDirective(directive,this);
    },
    "ai.dueros.device_interface.speaker_controller":function(directive){
        return this.speakerManager.handleDirective(directive,this);
    },
    "ai.dueros.device_interface.audio_player":function(directive){
        return this.audioPlayerManager.handleDirective(directive,this);
    }
};

function DcsController(options){
    this.locationManager=new LocationManager(this);
    this.alertManager=new AlertManager(this);
    this.audioPlayerManager=new AudioPlayerManager(this);
    this.speakerManager=new SpeakerManager(this);
    this.voiceOutputManager=new VoiceOutputManager(this);
    this.voiceInputManager=new VoiceInputManager(this);
    this.screenManager=new ScreenManager(this);
    this.httpManager=new HttpManager(this);
    this._contents={};
    this.queue=[];
}
util.inherits(DcsController, EventEmitter);

DcsController.prototype.isPlaying=function(){
    return (this.audioPlayerManager.isPlaying()||this.voiceOutputManager.isPlaying()||this.alertManager.isActive());

};

DcsController.prototype.getContext=function(namespace){
    var context=[];
    var alertContext=this.alertManager.getContext();
    if(alertContext){
        context.push(alertContext);
    }
    var audioContext=this.audioPlayerManager.getContext();
    if(audioContext){
        context.push(audioContext);
    }
    
    var speakerContext=this.speakerManager.getContext();
    if(speakerContext){
        context.push(speakerContext);
    }

    var voiceInputContext=this.voiceInputManager.getContext();
    if(voiceInputContext){
        context.push(voiceInputContext);
    }
    
    var voiceOutputContext=this.voiceOutputManager.getContext();
    if(voiceOutputContext){
        context.push(voiceOutputContext);
    }
    
    var locationContext=this.locationManager.getContext();
    if(locationContext){
        context.push(locationContext);
    }

    var screenContext=this.screenManager.getContext();
    if(screenContext){
        context.push(screenContext);
    }


    if(namespace){
        for(let i=0;i<context.length;i++){
            if(context[i].header.namespace==namespace){
                return context[i];
            }
        }
        return null;
    }


    return context;
    //TODO get all alerts
    //TODO get audio player
    //TODO get speaker status

};

DcsController.prototype.setClient=function(client){
    this.client=client;
    client.on("directive",(response)=>{
        this.handleResponse(response);
        this.emit("directive",response);
    });
    client.on("content",(content_id,content)=>{
        this.emit("content",content_id,content);
    });
    this.on("event",(dcs_event)=>{
        if(dcs_event &&dcs_event.event && dcs_event.event.header){
            if(
                dcs_event.event.header.namespace=="ai.dueros.device_interface.voice_input" &&
                dcs_event.event.header.name=="ListenStarted"
            ){
                return;
            }
        }
        client.sendEvent(dcs_event);
    });
};

DcsController.prototype.handleResponse=function(response){
    if(!response||!response.directive){
        return;
    }
    if(!response.directive.header.dialogRequestId){
        this.processDirective(response.directive);
        return;
    }
    
    if(this.currentDialogRequestId && response.directive.header.dialogRequestId==this.currentDialogRequestId){
        this.queue.push(response);
        if(!this.processing){
            this.deQueue();
        }
    }
};


DcsController.prototype.stopPlay=function(directive){
    this.audioPlayerManager.stop();
    this.voiceOutputManager.stop();
    this.alertManager.stopPlay();
};

DcsController.prototype.startRecognize=function(options){
    this.stopPlay();
    if(this.client){
        if(options&&options.wakeWordPcm){
            var wakeWordPcm=options.wakeWordPcm;
        }
        eventData=DcsProtocol.createRecognizeEvent(options);
        this.currentDialogRequestId = eventData.event.header.dialogRequestId;
        this.queue=[];
        eventData.clientContext=this.getContext();
        this.emit("event",eventData);
        return this.client.startRecognize(eventData,wakeWordPcm);
    }
    return false;
};
DcsController.prototype.stopRecognize=function(){
    if(this.client){
        return this.client.stopRecognize();
    }
    return false;
};
DcsController.prototype.isRecognizing=function(){
    if(this.client){
        return this.client.isRecognizing();
    }
    return false;
};
DcsController.prototype.processDirective=function(directive){
    var key=directive.header.namespace+"."+directive.header.name;
    var handler;
    do{
        if(directive_handlers.hasOwnProperty(key)){
            handler=directive_handlers[key]
            break;
        }
        let parts=key.split(".");
        parts.pop();
        key=parts.join(".");
    }while(key);
    if(!handler){
        console.log("no directive handler:"+JSON.stringify(directive));
        return;
    }

    var promise=directive_handlers[key].call(this,directive);
    return promise;
};
DcsController.prototype.deQueue=function(){
    this.processing=true;
    if(this.queue.length==0){
        this.processing=false;
        return;
    }
    var response=this.queue.shift();
    if(!response||!response.directive){
        this.deQueue();
        return;
    }
    var directive=response.directive;
    if((directive.header.dialogRequestId&&this.currentDialogRequestId)
            && directive.header.dialogRequestId!=this.currentDialogRequestId){
        this.deQueue();
        return;
    }
    
    var promise=this.processDirective(directive);
    if(promise && promise.then){
        promise
            .then(()=>{this.deQueue()})
            .catch(()=>{this.deQueue()});
    }else{
        this.deQueue();
    }
};

DcsController.prototype.setAccessToken=function(access_token){
    if(access_token){
        configModule.save("oauth_token",access_token);
    }
};
DcsController.prototype.getAccessToken=function(){
    return config.oauth_token;
};


module.exports=DcsController;
