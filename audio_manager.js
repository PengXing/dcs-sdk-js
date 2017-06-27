///播放器控制类，解决播放列表的问题
const EventEmitter=require("events");
const util = require('util');
const Player=require("./player");
function AudioManager(){
    this.playlist=[];
    this.player=new Player();
    this.player.on("stop",()=>{
        this.emit("stop");
    });
    this.player.on("pause",()=>{
        this.emit("pause");
    });
    this.player.on("play",()=>{
        this.emit("play");
    });
    this.player.on("finished",()=>{
        this.emit("finished");
        this.playNext();
    });
    this.player.on("time",(sec)=>{
        this.offset_ms=sec*1000;
    });
}
util.inherits(AudioManager, EventEmitter);
var handlers={
    "ClearQueue":function(directive){
        if(directive.payload.clearBehavior=="CLEAR_ENQUEUED"){
            this.playlist=[];
        }
        if(directive.payload.clearBehavior=="CLEAR_ALL"){
            this.playlist=[];
            this.stop();
        }
    },
    "Stop":function(directive){
        this.player.stop();
    },
    "Play":function(directive){

//    - REPLACE_ALL: 停止当前的播放（如有必要，发送PlaybackStopped事件）并清除播放列表，立即播放本stream；
//    - ENQUEUE: 把本stream加到播放队列末尾
//    - REPLACE_ENQUEUED: 清除当前播放列表，把本stream放到播放列表；不影响当前正在播放的stream
        if(directive.payload.playBehavior=="REPLACE_ALL"){
            this.playlist=[];
            this.player.openFile(directive.payload.audioItem.stream.url);
            if(directive.payload.audioItem.stream.offsetInMilliseconds){
                this.player.seek(parseInt(directive.payload.audioItem.stream.offsetInMilliseconds/1000));
            }
            this.player.play();
            this.last_played_token=directive.payload.audioItem.stream.token;
        }
        if(directive.payload.playBehavior=="ENQUEUE"){
            this.playlist.push({url:directive.payload.audioItem.stream.url,"token":directive.payload.audioItem.stream.token});
            if(!this.isPlaying()){
                this.playNext();
            }
        }
        if(directive.payload.playBehavior=="REPLACE_ENQUEUED"){
            this.playlist=[{url:directive.payload.audioItem.stream.url,"token":directive.payload.audioItem.stream.token}];
            if(!this.isPlaying()){
                this.playNext();
            }
        }
    }
};
AudioManager.prototype.playNext=function(){
    if(this.playlist.length>0){
        let playitem=this.playlist.shift();
        this.player.openFile(playitem.url);
        this.last_played_token=playitem.token;
        this.player.play();
    }
};
AudioManager.prototype.isPlaying=function(){
    return this.player.isPlaying();
};
AudioManager.prototype.stop=function(){
    return this.player.stop();
};
AudioManager.prototype.getContext=function(){
    return {
        "header": {
            "namespace": "ai.dueros.device_interface.audio_player",
            "name": "PlaybackState"
        },
        "payload": {
            "token": this.last_played_token,
            "offsetInMilliseconds": this.offset_ms,
            "playerActivity": this.isPlaying()?"PLAYING":"IDLE"
        }
    };

};
AudioManager.prototype.handleDirective=function (directive){
    var name=directive.header.name;
    if(handlers[name]){
        handlers[name].call(this,directive);
    }
}

module.exports=AudioManager;
