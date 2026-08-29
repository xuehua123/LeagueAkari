"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CaptureSession = void 0;
exports.load = load;
exports.isLoaded = isLoaded;
exports.isWgcSupported = isWgcSupported;
exports.isDdaSupported = isDdaSupported;
exports.inspectTargetEnvironment = inspectTargetEnvironment;
const addon_binding_1 = require("../addon-binding");
const addon = new addon_binding_1.NativeAddonBinding('capture', () => require('../../addons/akari-capture-win64.node'));
function load() {
    addon.load();
}
function isLoaded() {
    return addon.isLoaded();
}
function isWgcSupported() {
    return addon.get().isWgcSupported();
}
function isDdaSupported() {
    return addon.get().isDdaSupported();
}
function inspectTargetEnvironment(options) {
    return addon.get().inspectTargetEnvironment(options);
}
class CaptureSession {
    constructor(options) {
        const Binding = addon.get().CaptureSession;
        this._binding = new Binding(options);
    }
    captureFrame(timeoutMs = 100) {
        return this._binding.captureFrame(timeoutMs);
    }
    dispose() {
        this._binding.dispose();
    }
}
exports.CaptureSession = CaptureSession;
