"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SpeechSynthesizer = void 0;
exports.load = load;
exports.isLoaded = isLoaded;
exports.playEarcon = playEarcon;
const addon_binding_1 = require("../addon-binding");
const addon = new addon_binding_1.NativeAddonBinding('speech', () => require('../../addons/akari-speech-win64.node'));
function load() {
    addon.load();
}
function isLoaded() {
    return addon.isLoaded();
}
function playEarcon(category, volume) {
    return addon.get().playEarcon(category, volume);
}
class SpeechSynthesizer {
    constructor() {
        const Binding = addon.get().SpeechSynthesizer;
        this._binding = new Binding();
    }
    listVoices() {
        return this._binding.listVoices();
    }
    listOutputDevices() {
        return this._binding.listOutputDevices();
    }
    speak(text, options) {
        return this._binding.speak(text, options);
    }
    getOperationState(operationId) {
        return this._binding.getOperationState(operationId);
    }
    cancel(operationId) {
        return this._binding.cancel(operationId);
    }
    pause() {
        return this._binding.pause();
    }
    resume() {
        return this._binding.resume();
    }
    dispose() {
        this._binding.dispose();
    }
}
exports.SpeechSynthesizer = SpeechSynthesizer;
