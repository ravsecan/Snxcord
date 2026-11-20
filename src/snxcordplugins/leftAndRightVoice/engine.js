/* Snxcord — Left And Right Voice motoru.
 * Kullanicinin verdigi script OLDUGU GIBI gomuldu; sadece panel basligina logo+isim eklendi.
 * SPDX-License-Identifier: GPL-3.0-or-later */
/* eslint-disable */
let __lrvStarted = false;
export function startLeftAndRightVoice() {
  if (__lrvStarted) return;
  __lrvStarted = true;
(function () {
'use strict';

const CFG = Object.freeze({
  mic: Object.freeze({
    channelCount:     { ideal: 2 },
    sampleRate:       { ideal: 48000 },
    sampleSize:       { ideal: 16 },
    echoCancellation: { exact: false },
    noiseSuppression: { exact: false },
    autoGainControl:  { exact: false },
  }),
  opus: Object.freeze({
    stereo:            '1',
    'sprop-stereo':    '1',
    maxaveragebitrate: '512000',
    maxplaybackrate:   '48000',
    usedtx:            '0',
    useinbandfec:      '0',
    minptime:          '10',
    ptime:             '20',
  }),
  bitrate: 512000,
  blocklist: ['krisp', 'noise', 'suppression'],
  eq: Object.freeze([
    { freq:    20, gain: 0, q: 1.0 },
    { freq:    31, gain: 0, q: 1.0 },
    { freq:    40, gain: 0, q: 1.0 },
    { freq:    50, gain: 0, q: 1.0 },
    { freq:    63, gain: 0, q: 1.0 },
    { freq:    80, gain: 0, q: 1.0 },
    { freq:   100, gain: 0, q: 1.0 },
    { freq:   125, gain: 0, q: 1.0 },
    { freq:   160, gain: 0, q: 1.0 },
    { freq:   200, gain: 0, q: 1.0 },
    { freq:   250, gain: 0, q: 1.0 },
    { freq:   315, gain: 0, q: 1.0 },
    { freq:   400, gain: 0, q: 1.0 },
    { freq:   500, gain: 0, q: 1.0 },
    { freq:   630, gain: 0, q: 1.0 },
    { freq:   800, gain: 0, q: 1.0 },
    { freq:  1000, gain: 0, q: 1.0 },
    { freq:  1250, gain: 0, q: 1.0 },
    { freq:  1600, gain: 0, q: 1.0 },
    { freq:  2000, gain: 0, q: 1.0 },
    { freq:  2500, gain: 0, q: 1.0 },
    { freq:  3150, gain: 0, q: 1.0 },
    { freq:  4000, gain: 0, q: 1.0 },
    { freq:  5000, gain: 0, q: 1.0 },
    { freq:  6300, gain: 0, q: 1.0 },
    { freq:  8000, gain: 0, q: 1.0 },
    { freq: 10000, gain: 0, q: 1.0 },
    { freq: 12500, gain: 0, q: 1.0 },
    { freq: 16000, gain: 0, q: 1.0 },
    { freq: 20000, gain: 0, q: 1.0 },
  ]),
});

const State = new class {
  #live      = null;
  #processed = null;
  #sym       = Symbol('dsm');

  setRaw(track)       { this.#live = track; }
  getRaw()            { return this.#live; }
  setProcessed(track) { this.#processed = track; }
  getProcessed()      { return this.#processed; }
  outbound()          { return this.#processed ?? this.#live; }
  key()               { return this.#sym; }
  active()            { return this.outbound()?.readyState === 'live'; }
  foreign(t)          { return t?.kind === 'audio' && this.active() && t.id !== this.outbound().id; }
};

class SDPEditor {
  static #RTPMAP = /^a=rtpmap:(\d+)\s+opus\/48000\/2/gm;
  static #FMTP   = (pt) => new RegExp(`^a=fmtp:${pt}\\s+(.*)$`, 'm');

  static #decode(str) {
    return Object.fromEntries(
      str.split(';').flatMap(p => {
        const [k, ...v] = p.trim().split('=');
        return k ? [[k.trim(), v.join('=').trim()]] : [];
      })
    );
  }

  static #encode(map) {
    return Object.entries(map).map(([k, v]) => `${k}=${v}`).join(';');
  }

  static #opusPTs(sdp) {
    const pts = new Set();
    let m;
    const re = new RegExp(SDPEditor.#RTPMAP.source, 'gm');
    while ((m = re.exec(sdp)) !== null) pts.add(m[1]);
    return [...pts];
  }

  static #rewriteFmtp(sdp, pt) {
    const re = SDPEditor.#FMTP(pt);
    const match = re.exec(sdp);
    if (!match) return sdp;
    const remote = SDPEditor.#decode(match[1]);
    delete remote.cbr;
    delete remote.usedtx;
    const merged = { ...remote, ...CFG.opus };
    return sdp.replace(match[0], `a=fmtp:${pt} ${SDPEditor.#encode(merged)}`);
  }

  static #stripCaps(sdp) {
    return sdp.replace(/^b=AS:\d+\r?\n?/gm, '').replace(/^b=TIAS:\d+\r?\n?/gm, '');
  }

  static process(sdp) {
    if (typeof sdp !== 'string') return sdp;
    return SDPEditor.#stripCaps(
      SDPEditor.#opusPTs(sdp).reduce(SDPEditor.#rewriteFmtp.bind(SDPEditor), sdp)
    );
  }
}

class BitrateLayer {
  static #pcs = new Set();

  static #encoding(enc = {}) {
    const out = { ...enc, active: true, dtx: 'disabled', ptime: 20, priority: 'high', networkPriority: 'high' };
    delete out.minBitrate;
    if (out.maxBitrate != null && out.maxBitrate < CFG.bitrate) out.maxBitrate = CFG.bitrate;
    else if (out.maxBitrate == null) out.maxBitrate = CFG.bitrate;
    return out;
  }

  static encodings(encs) {
    return (encs ?? [{}]).map(e => BitrateLayer.#encoding(e));
  }

  static apply(sender) {
    if (sender?.track?.kind !== 'audio') return;
    try {
      const p = sender.getParameters();
      p.encodings = (p.encodings?.length ? p.encodings : [{}]).map(BitrateLayer.#encoding);
      sender.setParameters(p);
      TrackLayer.purify(sender.track);
    } catch (_) {}
  }

  static track(pc) {
    BitrateLayer.#pcs.add(pc);
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'closed') BitrateLayer.#pcs.delete(pc);
      else if (pc.connectionState === 'connected')
        pc.getSenders().forEach(s => BitrateLayer.apply(s));
    });
  }

  static install() {
    const Orig = RTCPeerConnection;
    const wrapped = function (...args) {
      const pc = new Orig(...args);
      BitrateLayer.track(pc);
      return pc;
    };
    wrapped.prototype = Orig.prototype;
    Object.setPrototypeOf(wrapped, Orig);
    window.RTCPeerConnection = wrapped;
  }
}

class TrackLayer {
  static #clean = Object.freeze({
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl:  false,
  });

  static purify(track) {
    if (!track || track.kind !== 'audio') return;
    try { track.contentHint = 'music'; } catch (_) {}
    track.applyConstraints(TrackLayer.#clean).catch(() => {});
  }

  static install() {
    Interceptor.async_(MediaStreamTrack.prototype, 'applyConstraints', async (o, c) => {
      if (this.kind !== 'audio') return o(c);
      const clean = { ...c, ...TrackLayer.#clean };
      if (Array.isArray(c?.advanced))
        clean.advanced = c.advanced.map(a => ({ ...a, ...TrackLayer.#clean }));
      return o(clean);
    });
  }
}

class Interceptor {
  static #wrap(target, key, builder) {
    const original = target[key];
    if (!original) return;
    const replacement = builder(original);
    replacement.toString = () => original.toString();
    target[key] = replacement;
  }

  static async_(target, key, builder) {
    Interceptor.#wrap(target, key, (orig) =>
      function (...args) { return builder(orig.bind(this), ...args); }
    );
  }

  static sync(target, key, builder) {
    Interceptor.#wrap(target, key, (orig) =>
      function (...args) { return builder.call(this, orig.bind(this), ...args); }
    );
  }
}

const sdpDesc    = (orig, desc) => orig(desc?.sdp ? { type: desc.type, sdp: SDPEditor.process(desc.sdp) } : desc);
const sdpResult  = async (orig, ...args) => { const r = await orig(...args); return { type: r.type, sdp: SDPEditor.process(r.sdp) }; };

class MicLayer {
  static install() {
    const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (constraints) => {
      if (!constraints?.audio) return gum(constraints);
      const deviceId = constraints.audio?.deviceId;
      const audio = { ...CFG.mic, ...(deviceId ? { deviceId } : {}) };
      return gum({ ...constraints, audio }).then(stream => {
        const t = stream.getAudioTracks()[0];
        if (t) {
          State.setRaw(t);
          TrackLayer.purify(t);
          const ctx = AudioPipelineLayer.getContext();
          if (ctx.state === 'suspended') ctx.resume();
          const src = ctx.createMediaStreamSource(new MediaStream([t]));
          AudioPipelineLayer.connectMicSource(src);
        }
        return stream;
      });
    };
  }
}

class AudioPipelineLayer {
  static #ctx         = null;
  static #nodes       = {};
  static #bands       = [];
  static #ready       = false;
  static #leftVal     = 0;
  static #rightVal    = 0;
  static #stereoWidth = 0;
  static #volumeBoost = 1;
  static #crackle     = 0;
  static #crackleMix  = 0;
  static #saturation  = 0;
  static #exciterAmount = 0;
  static #highShelfGain = 0;
  static #limiterThreshold = -1;
  static #voiceSpeed  = 1;
  static #lfoSpeed    = 1.5;
  static #lfoDepth    = 0;
  static #lfoEnabled  = false;
  static #lfoLink     = true;
  static #crackleTimer = null;
  static #ringL       = null;
  static #ringR       = null;
  static #ringSize    = 96000;
  static #ringWrite    = 0;
  static #ringRead     = 0;
  static #wtfDelay = 0;
  static #wtfTime = 0;
  static #eightDEnabled = false;
  static #eightDSpeed = 1;
  static #eightDDepth = 1;
  static #eightDAngle = 0;
  static #eightDTimer = null;

  static install() {
    AudioPipelineLayer.#boot();
  }

  static #makeDistortionCurve(amount) {
    const n_samples = 44100;
    const curve = new Float32Array(n_samples);
    for (let i = 0; i < n_samples; ++i) {
      const x = (i * 2) / n_samples - 1;
      if (amount === 0) {
        curve[i] = x;
      } else {
        const factor = 1 + (amount * amount) / 100;
        curve[i] = Math.tanh(x * factor) / Math.tanh(factor);
      }
    }
    return curve;
  }

  static #makeExciterCurve(amount) {
    const n_samples = 44100;
    const curve = new Float32Array(n_samples);
    for (let i = 0; i < n_samples; ++i) {
      const x = (i * 2) / n_samples - 1;
      if (amount > 0) {
        const drive = amount / 100;
        curve[i] = Math.tanh(x * (1 + drive * 3));
      } else {
        curve[i] = x;
      }
    }
    return curve;
  }

  static #makeCrackleCurve(amount) {
    const n = 4096;
    const curve = new Float32Array(n);
    const bits = Math.max(1, 16 - (amount / 100) * 15);
    const steps = Math.pow(2, bits);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      let y = Math.round(x * steps) / steps;
      
      if (amount > 0) {
        const intensity = amount / 100;
        if (Math.random() < intensity * 0.15) {
          y = (Math.random() * 2 - 1) * intensity * 2;
        }
        if (Math.random() < intensity * 0.1) {
          y *= Math.random() < 0.5 ? 0 : (Math.random() * 2 - 1);
        }
        if (amount > 30 && Math.random() < intensity * 0.05) {
          y += (Math.random() - 0.5) * 0.5;
        }
        if (amount > 50 && Math.random() < intensity * 0.03) {
          y = (Math.random() * 2 - 1) * 0.8;
        }
      }
      curve[i] = y;
    }
    return curve;
  }

  static #constantPowerPan(pan, leftLvl, rightLvl) {
    const angle = ((pan + 1) * 0.5) * (Math.PI * 0.5);
    return {
      left:  Math.cos(angle) * leftLvl,
      right: Math.sin(angle) * rightLvl,
    };
  }

  static #readRing(ring, pos) {
    const idx = Math.floor(pos) % AudioPipelineLayer.#ringSize;
    const frac = pos - Math.floor(pos);
    const next = (idx + 1) % AudioPipelineLayer.#ringSize;
    return ring[idx] * (1 - frac) + ring[next] * frac;
  }

  static #writeRing(ring, data) {
    let w = AudioPipelineLayer.#ringWrite;
    for (let i = 0; i < data.length; i++) {
      ring[w] = data[i];
      w = (w + 1) % AudioPipelineLayer.#ringSize;
    }
    AudioPipelineLayer.#ringWrite = w;
  }

  static #processSpeed(inputL, inputR, outputL, outputR) {
    const speed = AudioPipelineLayer.#voiceSpeed;
    AudioPipelineLayer.#writeRing(AudioPipelineLayer.#ringL, inputL);
    AudioPipelineLayer.#writeRing(AudioPipelineLayer.#ringR, inputR.length ? inputR : inputL);

    let r = AudioPipelineLayer.#ringRead;
    const w = AudioPipelineLayer.#ringWrite;
    const available = (w - r + AudioPipelineLayer.#ringSize) % AudioPipelineLayer.#ringSize;

    if (available < 2048) {
      outputL.set(inputL);
      outputR.set(inputR.length ? inputR : inputL);
      AudioPipelineLayer.#ringRead = r;
      return;
    }

    for (let i = 0; i < outputL.length; i++) {
      outputL[i] = AudioPipelineLayer.#readRing(AudioPipelineLayer.#ringL, r);
      outputR[i] = AudioPipelineLayer.#readRing(AudioPipelineLayer.#ringR, r);
      r += speed;
      if (r >= w) r = Math.max(0, w - 4800);
    }
    AudioPipelineLayer.#ringRead = r;
  }

  static #spawnCrackleBurst() {
    const amt = AudioPipelineLayer.#crackle;
    const { ctx, crackleMix, crackleNoiseGain } = AudioPipelineLayer.#nodes;
    if (!ctx || !crackleMix || amt <= 0) return;

    const dur = 0.02 + Math.random() * 0.06;
    const frames = Math.ceil(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(2, frames, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < frames; i++) {
        const env = Math.exp(-i / (ctx.sampleRate * 0.008));
        d[i] = (Math.random() * 2 - 1) * env;
      }
    }

    const src = ctx.createBufferSource();
    src.buffer = buf;
    const burstGain = ctx.createGain();
    const peak = (amt / 100) * (0.4 + Math.random() * 0.9);
    burstGain.gain.setValueAtTime(peak, ctx.currentTime);
    burstGain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    src.connect(burstGain);
    burstGain.connect(crackleMix);
    src.start();
    src.stop(ctx.currentTime + dur + 0.01);
  }

  static #scheduleCrackle() {
    if (AudioPipelineLayer.#crackleTimer) clearTimeout(AudioPipelineLayer.#crackleTimer);
    const tick = () => {
      const amt = AudioPipelineLayer.#crackle;
      if (amt > 0) {
        AudioPipelineLayer.#spawnCrackleBurst();
        if (Math.random() < amt / 100) AudioPipelineLayer.#spawnCrackleBurst();
      }
      const interval = amt <= 0 ? 400 : Math.max(15, 220 - amt * 1.8 + Math.random() * 80);
      AudioPipelineLayer.#crackleTimer = setTimeout(tick, interval);
    };
    tick();
  }

  static #update8D() {
    if (!AudioPipelineLayer.#eightDEnabled) return;
    const { eightDPanner } = AudioPipelineLayer.#nodes;
    if (!eightDPanner) return;

    AudioPipelineLayer.#eightDAngle += AudioPipelineLayer.#eightDSpeed * 0.02;
    if (AudioPipelineLayer.#eightDAngle > Math.PI * 2) AudioPipelineLayer.#eightDAngle -= Math.PI * 2;

    const pan = Math.sin(AudioPipelineLayer.#eightDAngle) * AudioPipelineLayer.#eightDDepth;
    eightDPanner.pan.value = Math.max(-1, Math.min(1, pan));

    AudioPipelineLayer.#eightDTimer = requestAnimationFrame(AudioPipelineLayer.#update8D.bind(AudioPipelineLayer));
  }

  static #start8D() {
    if (AudioPipelineLayer.#eightDTimer) cancelAnimationFrame(AudioPipelineLayer.#eightDTimer);
    if (AudioPipelineLayer.#eightDEnabled) {
      AudioPipelineLayer.#update8D();
    }
  }

  static #stop8D() {
    if (AudioPipelineLayer.#eightDTimer) {
      cancelAnimationFrame(AudioPipelineLayer.#eightDTimer);
      AudioPipelineLayer.#eightDTimer = null;
    }
    const { eightDPanner } = AudioPipelineLayer.#nodes;
    if (eightDPanner) eightDPanner.pan.value = 0;
  }


  static #applyStereoControls() {
    const { delayL, delayR, gainL, gainR, lfoGain, lfo, stereoEnhancerL, stereoEnhancerR } = AudioPipelineLayer.#nodes;
    if (!delayL || !delayR || !gainL || !gainR || !lfoGain) return;

    const leftDelay  = (AudioPipelineLayer.#leftVal * 2.5) / 1000;
    const rightDelay = (AudioPipelineLayer.#rightVal * 2.5) / 1000;
    delayL.delayTime.value = leftDelay;
    delayR.delayTime.value = rightDelay;

    const pan = (AudioPipelineLayer.#rightVal - AudioPipelineLayer.#leftVal) / 100;
    const leftLvl  = 0.5 + (AudioPipelineLayer.#leftVal / 100) * 0.8;
    const rightLvl = 0.5 + (AudioPipelineLayer.#rightVal / 100) * 0.8;
    const panned = AudioPipelineLayer.#constantPowerPan(pan, leftLvl, rightLvl);
    gainL.gain.value = panned.left;
    gainR.gain.value = panned.right;

    if (stereoEnhancerL && stereoEnhancerR) {
      const clarity = 0.08 + (Math.max(AudioPipelineLayer.#leftVal, AudioPipelineLayer.#rightVal) / 100) * 0.12;
      stereoEnhancerL.gain.value = clarity;
      stereoEnhancerR.gain.value = clarity;
    }

    lfo.frequency.value = AudioPipelineLayer.#lfoSpeed;

    let effectiveDepth = 0;
    if (AudioPipelineLayer.#lfoEnabled) {
      if (AudioPipelineLayer.#lfoLink) {
        effectiveDepth = Math.min(AudioPipelineLayer.#leftVal, AudioPipelineLayer.#rightVal) / 100;
      } else {
        effectiveDepth = AudioPipelineLayer.#lfoDepth / 100;
      }
    } else {
      effectiveDepth = Math.min(AudioPipelineLayer.#leftVal, AudioPipelineLayer.#rightVal) / 100;
    }

    lfoGain.gain.value = effectiveDepth;
  }

  static #boot() {
    const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
    AudioPipelineLayer.#ctx = ctx;
    AudioPipelineLayer.#ringL = new Float32Array(AudioPipelineLayer.#ringSize);
    AudioPipelineLayer.#ringR = new Float32Array(AudioPipelineLayer.#ringSize);

    const masterGain = ctx.createGain();
    const volumeBoostGain = ctx.createGain();
    volumeBoostGain.gain.value = AudioPipelineLayer.#volumeBoost;

    const splitter   = ctx.createChannelSplitter(2);
    const merger     = ctx.createChannelMerger(2);
    const delayL     = ctx.createDelay(2.0);
    const delayR     = ctx.createDelay(2.0);
    const gainL      = ctx.createGain();
    const gainR      = ctx.createGain();
    gainL.gain.value = 1.0;
    gainR.gain.value = 1.0;

    const widthGainL = ctx.createGain();
    const widthGainR = ctx.createGain();
    widthGainL.gain.value = 0.0;
    widthGainR.gain.value = 0.0;

    const stereoEnhancerL = ctx.createBiquadFilter();
    stereoEnhancerL.type = 'highshelf';
    stereoEnhancerL.frequency.value = 3000;
    stereoEnhancerL.gain.value = 0.08;

    const stereoEnhancerR = ctx.createBiquadFilter();
    stereoEnhancerR.type = 'highshelf';
    stereoEnhancerR.frequency.value = 3000;
    stereoEnhancerR.gain.value = 0.08;

    const bassBoostFilter = ctx.createBiquadFilter();
    bassBoostFilter.type = 'lowshelf';
    bassBoostFilter.frequency.value = 150;
    bassBoostFilter.gain.value = 0;

    const reverbConvolver = ctx.createConvolver();
    const reverbGain = ctx.createGain();
    reverbGain.gain.value = 0;
    const reverbMixGain = ctx.createGain();
    reverbMixGain.gain.value = 0;

    const chorusDelay = ctx.createDelay(0.1);
    const wtfDelay = ctx.createDelay(2.0);
    wtfDelay.delayTime.value = 0;
    const wtfGain = ctx.createGain();
    wtfGain.gain.value = 0;
    const wtfDry = ctx.createGain();
    wtfDry.gain.value = 1;
    const wtfWet = ctx.createGain();
    wtfWet.gain.value = 0;

    const highShelfFilter = ctx.createBiquadFilter();
    highShelfFilter.type = 'highshelf';
    highShelfFilter.frequency.value = 8000;
    highShelfFilter.gain.value = 0;
    highShelfFilter.Q.value = 0.5;

    const exciterFilter = ctx.createBiquadFilter();
    exciterFilter.type = 'highpass';
    exciterFilter.frequency.value = 5000;
    exciterFilter.Q.value = 1;
    const exciterGain = ctx.createGain();
    exciterGain.gain.value = 0;
    const exciterDistortion = ctx.createWaveShaper();
    exciterDistortion.oversample = '4x';
    exciterDistortion.curve = AudioPipelineLayer.#makeExciterCurve(0);
    const exciterMix = ctx.createGain();
    exciterMix.gain.value = 0;

    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.1;

    const crackleNode = ctx.createWaveShaper();
    crackleNode.oversample = '4x';
    crackleNode.curve = AudioPipelineLayer.#makeCrackleCurve(AudioPipelineLayer.#crackle);

    const crackleMix = ctx.createGain();
    crackleMix.gain.value = 1;

    const distortionNode = ctx.createWaveShaper();
    distortionNode.oversample = '4x';
    distortionNode.curve = AudioPipelineLayer.#makeDistortionCurve(AudioPipelineLayer.#saturation);
    const crackleNoiseGain = ctx.createGain();
    crackleNoiseGain.gain.value = 0;

    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = AudioPipelineLayer.#lfoSpeed;

    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.0;

    const lfoInverter = ctx.createGain();
    lfoInverter.gain.value = -1.0;

    const eightDPanner = ctx.createStereoPanner();
    eightDPanner.pan.value = 0;

    lfo.connect(lfoGain);
    lfoGain.connect(gainL.gain);
    lfoGain.connect(lfoInverter);
    lfoInverter.connect(gainR.gain);
    lfo.start();

    const micMix     = ctx.createGain();
    const musicMix   = ctx.createGain();
    const mixer      = ctx.createGain();
    const speedNode  = ctx.createScriptProcessor(2048, 2, 2);
    speedNode.onaudioprocess = (e) => {
      const inL  = e.inputBuffer.getChannelData(0);
      const inR  = e.inputBuffer.numberOfChannels > 1 ? e.inputBuffer.getChannelData(1) : inL;
      const outL = e.outputBuffer.getChannelData(0);
      const outR = e.outputBuffer.numberOfChannels > 1 ? e.outputBuffer.getChannelData(1) : outL;
      if (AudioPipelineLayer.#voiceSpeed === 1) {
        outL.set(inL);
        outR.set(inR);
        return;
      }
      AudioPipelineLayer.#processSpeed(inL, inR, outL, outR);
    };

    const dest       = ctx.createMediaStreamDestination();
    dest.channelCount          = 2;
    dest.channelCountMode      = 'explicit';
    dest.channelInterpretation = 'discrete';

    micMix.gain.value = 1;
    musicMix.gain.value = 1;
    masterGain.gain.value = 1;

    const bands = CFG.eq.map(({ freq, gain, q }) => {
      const f = ctx.createBiquadFilter();
      f.type      = 'peaking';
      f.frequency.value = freq;
      f.gain.value      = gain;
      f.Q.value         = q;
      return { node: f, enabled: true, defaultGain: gain };
    });

    AudioPipelineLayer.#bands = bands;

    const chain = [volumeBoostGain, ...bands.map(b => b.node), highShelfFilter, crackleNode, limiter];

    exciterFilter.connect(exciterDistortion);
    exciterDistortion.connect(exciterGain);
    exciterGain.connect(exciterMix);
    exciterMix.connect(masterGain);
    volumeBoostGain.connect(exciterFilter);
    micMix.connect(mixer);
    musicMix.connect(mixer);
    mixer.connect(speedNode);
    chain.reduce((a, b) => { a.connect(b); return b; }, speedNode);

    speedNode.connect(wtfDry);
    speedNode.connect(wtfWet);
    wtfWet.connect(wtfDelay);
    wtfDelay.connect(masterGain);
    wtfDry.connect(masterGain);

    masterGain.connect(eightDPanner);
    eightDPanner.connect(splitter);
    splitter.connect(gainL, 0);
    splitter.connect(gainR, 1);

    gainL.connect(stereoEnhancerL);
    gainR.connect(stereoEnhancerR);
    stereoEnhancerL.connect(delayL);
    stereoEnhancerR.connect(delayR);

    gainL.connect(widthGainR);
    gainR.connect(widthGainL);
    widthGainL.connect(delayL);
    widthGainR.connect(delayR);

    delayL.connect(merger, 0, 0);
    delayR.connect(merger, 0, 1);
    merger.connect(crackleMix);
    crackleNoiseGain.connect(crackleMix);
    crackleMix.connect(dest);

    AudioPipelineLayer.#nodes = {
      ctx, masterGain, volumeBoostGain, splitter, merger, delayL, delayR,
      gainL, gainR, widthGainL, widthGainR, stereoEnhancerL, stereoEnhancerR,
      crackleNode, crackleMix, crackleNoiseGain, distortionNode,
      lfo, lfoGain, lfoInverter, speedNode,
      micMix, musicMix, mixer, dest,
      wtfDelay, wtfGain, wtfDry, wtfWet,
      highShelfFilter, exciterFilter, exciterGain, exciterDistortion, exciterMix, limiter,
      eightDPanner,
    };

    wtfDry.connect(masterGain);
    wtfWet.connect(wtfDelay);
    wtfDelay.connect(wtfWet);
    wtfWet.connect(masterGain);
    AudioPipelineLayer.#ready = true;
    AudioPipelineLayer.#applyStereoControls();
    AudioPipelineLayer.#scheduleCrackle();

    const outTrack = dest.stream.getAudioTracks()[0];
    TrackLayer.purify(outTrack);
    State.setProcessed(outTrack);
  }

  static #assertReady() {
    if (!AudioPipelineLayer.#ready) throw new Error('AudioPipelineLayer not ready');
  }

  static getContext()  { return AudioPipelineLayer.#ctx; }
  static getNodes()    { return AudioPipelineLayer.#nodes; }

  static connectMicSource(sourceNode) {
    sourceNode.connect(AudioPipelineLayer.#nodes.micMix);
  }

  static connectMusicSource(sourceNode) {
    sourceNode.connect(AudioPipelineLayer.#nodes.musicMix);
  }

  static setBand(index, gain) {
    AudioPipelineLayer.#assertReady();
    const band = AudioPipelineLayer.#bands[index];
    if (!band) return;
    const clampedGain = Math.max(-24, Math.min(24, gain));
    band.node.gain.value = band.enabled ? clampedGain : 0;
    band.defaultGain = clampedGain;
  }

  static enableBand(index, bool) {
    AudioPipelineLayer.#assertReady();
    const band = AudioPipelineLayer.#bands[index];
    if (!band) return;
    band.enabled = bool;
    band.node.gain.value = bool ? band.defaultGain : 0;
  }

  static setMasterGain(value) {
    AudioPipelineLayer.#assertReady();
    const clampedValue = Math.max(0, Math.min(100, value));
    AudioPipelineLayer.#nodes.masterGain.gain.value = clampedValue;
  }

  static resetAll() {
    AudioPipelineLayer.#assertReady();
    AudioPipelineLayer.#nodes.masterGain.gain.value = 1;
    AudioPipelineLayer.#nodes.micMix.gain.value = 1;
    AudioPipelineLayer.#nodes.musicMix.gain.value = 1;
    AudioPipelineLayer.#leftVal = 0;
    AudioPipelineLayer.#rightVal = 0;
    AudioPipelineLayer.#stereoWidth = 0;
    AudioPipelineLayer.#volumeBoost = 1;
    AudioPipelineLayer.#crackle = 0;
    AudioPipelineLayer.#crackleMix = 0;
    AudioPipelineLayer.#saturation = 0;
    AudioPipelineLayer.#exciterAmount = 0;
    AudioPipelineLayer.#highShelfGain = 0;
    AudioPipelineLayer.#limiterThreshold = -3;
    AudioPipelineLayer.#voiceSpeed = 1;
    AudioPipelineLayer.#ringWrite = 0;
    AudioPipelineLayer.#ringRead = 0;
    AudioPipelineLayer.#lfoSpeed = 1.5;
    AudioPipelineLayer.#lfoDepth = 0;
    AudioPipelineLayer.#lfoEnabled = false;
    AudioPipelineLayer.#lfoLink = true;
    AudioPipelineLayer.#wtfDelay = 0;
    AudioPipelineLayer.#wtfTime = 0;
    AudioPipelineLayer.#eightDEnabled = false;
    AudioPipelineLayer.#eightDSpeed = 1;
    AudioPipelineLayer.#eightDDepth = 1;
    AudioPipelineLayer.#eightDAngle = 0;
    AudioPipelineLayer.#stop8D();
    AudioPipelineLayer.#applyStereoControls();

    const { volumeBoostGain, crackleNode, distortionNode, widthGainL, widthGainR, wtfDelay, wtfDry, wtfWet, highShelfFilter, exciterDistortion, exciterGain, exciterMix, limiter } = AudioPipelineLayer.#nodes;
    if (volumeBoostGain) volumeBoostGain.gain.value = 1;
    if (crackleNode) crackleNode.curve = AudioPipelineLayer.#makeCrackleCurve(0);
    if (crackleMix) crackleMix.gain.value = 1;
    if (highShelfFilter) highShelfFilter.gain.value = 0;
    if (exciterDistortion) exciterDistortion.curve = AudioPipelineLayer.#makeExciterCurve(0);
    if (exciterGain) exciterGain.gain.value = 0;
    if (exciterMix) exciterMix.gain.value = 0;
    if (limiter) limiter.threshold.value = -3;
    if (distortionNode) {
      distortionNode.curve = AudioPipelineLayer.#makeDistortionCurve(0);
    }
    if (widthGainL && widthGainR) {
      widthGainL.gain.value = 0;
      widthGainR.gain.value = 0;
    }
    if (wtfDelay) wtfDelay.delayTime.value = 0;
    if (wtfDry) wtfDry.gain.value = 1;
    if (wtfWet) wtfWet.gain.value = 0;

    AudioPipelineLayer.resetEQ();
  }

  static resetEQ() {
    AudioPipelineLayer.#bands.forEach((b, i) => {
      b.defaultGain = CFG.eq[i].gain;
      b.node.gain.value = b.enabled ? CFG.eq[i].gain : 0;
    });
  }

  static applyEQPreset(preset) {
    AudioPipelineLayer.#assertReady();
    const presets = {
      'flat': new Array(30).fill(0),
      'bass-boost': [4, 4, 4, 4, 3, 3, 2, 2, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      'vocal': [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0],
      'music': [3, 3, 2, 2, 2, 2, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 2, 3, 3, 4, 4, 4],
      'treble': [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 4, 5, 5, 6, 6, 6],
      'loud': [5, 5, 4, 4, 4, 4, 3, 3, 3, 2, 2, 2, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 2, 2, 3, 3, 4, 4, 4],
    };

    const gains = presets[preset] || presets['flat'];
    gains.forEach((gain, i) => {
      if (AudioPipelineLayer.#bands[i]) {
        AudioPipelineLayer.setBand(i, gain);
      }
    });
  }

  static muteMic(muted) {
    AudioPipelineLayer.#assertReady();
    AudioPipelineLayer.#nodes.micMix.gain.value = muted ? 0 : 1;
  }

  static setMusicVolume(value) {
    AudioPipelineLayer.#assertReady();
    AudioPipelineLayer.#nodes.musicMix.gain.value = value;
  }

  static setStereoDelay(leftVal, rightVal) {
    AudioPipelineLayer.#assertReady();
    AudioPipelineLayer.#leftVal  = Math.max(0, Math.min(100, leftVal));
    AudioPipelineLayer.#rightVal = Math.max(0, Math.min(100, rightVal));
    AudioPipelineLayer.#applyStereoControls();
  }

  static setStereoWidth(value) {
    AudioPipelineLayer.#assertReady();
    AudioPipelineLayer.#stereoWidth = Math.max(0, Math.min(100, value));
    const { widthGainL, widthGainR } = AudioPipelineLayer.#nodes;
    if (widthGainL && widthGainR) {
      const w = (AudioPipelineLayer.#stereoWidth / 100) * 1.2;
      widthGainL.gain.value = -w;
      widthGainR.gain.value = -w;
    }
  }

  static setVolumeBoost(value) {
    AudioPipelineLayer.#assertReady();
    AudioPipelineLayer.#volumeBoost = Math.max(1, Math.min(60, value));
    const { volumeBoostGain } = AudioPipelineLayer.#nodes;
    if (volumeBoostGain) volumeBoostGain.gain.value = AudioPipelineLayer.#volumeBoost;
  }

  static setExciter(amount) {
    AudioPipelineLayer.#assertReady();
    AudioPipelineLayer.#exciterAmount = Math.max(0, Math.min(100, amount));
    const { exciterDistortion, exciterGain, exciterMix } = AudioPipelineLayer.#nodes;
    if (exciterDistortion) exciterDistortion.curve = AudioPipelineLayer.#makeExciterCurve(AudioPipelineLayer.#exciterAmount);
    if (exciterGain) exciterGain.gain.value = 1 + (AudioPipelineLayer.#exciterAmount / 100) * 5;
    if (exciterMix) exciterMix.gain.value = AudioPipelineLayer.#exciterAmount / 100;
  }

  static setHighShelf(gain) {
    AudioPipelineLayer.#assertReady();
    AudioPipelineLayer.#highShelfGain = Math.max(0, Math.min(24, gain));
    const { highShelfFilter } = AudioPipelineLayer.#nodes;
    if (highShelfFilter) highShelfFilter.gain.value = AudioPipelineLayer.#highShelfGain;
  }

  static setLimiter(threshold) {
    AudioPipelineLayer.#assertReady();
    AudioPipelineLayer.#limiterThreshold = Math.max(-20, Math.min(0, threshold));
    const { limiter } = AudioPipelineLayer.#nodes;
    if (limiter) limiter.threshold.value = AudioPipelineLayer.#limiterThreshold;
  }

  static setWTF(time, mix) {
    AudioPipelineLayer.#assertReady();
    AudioPipelineLayer.#wtfTime = Math.max(0, Math.min(2000, time));
    AudioPipelineLayer.#wtfDelay = Math.max(0, Math.min(100, mix));
    const { wtfDelay, wtfDry, wtfWet } = AudioPipelineLayer.#nodes;
    if (wtfDelay) wtfDelay.delayTime.value = AudioPipelineLayer.#wtfTime / 1000;
    if (wtfDry) wtfDry.gain.value = 1;
    if (wtfWet) wtfWet.gain.value = AudioPipelineLayer.#wtfDelay / 100;
  }

  static triggerWTF() {
    AudioPipelineLayer.#assertReady();
    const { wtfDelay, wtfDry, wtfWet } = AudioPipelineLayer.#nodes;
    if (wtfDelay && wtfDry && wtfWet) {
      wtfDelay.delayTime.value = AudioPipelineLayer.#wtfTime / 1000;
      wtfDry.gain.value = 1;
      wtfWet.gain.value = AudioPipelineLayer.#wtfDelay / 100;
      
      setTimeout(() => {
        if (wtfWet) wtfWet.gain.value = 0;
      }, AudioPipelineLayer.#wtfTime + 100);
    }
  }

  static setCrackle(value) {
    AudioPipelineLayer.#assertReady();
    AudioPipelineLayer.#crackle = Math.max(0, Math.min(100, value));
    AudioPipelineLayer.#crackleMix = value;
    const { crackleNode, crackleMix } = AudioPipelineLayer.#nodes;
    if (crackleNode) {
      crackleNode.curve = AudioPipelineLayer.#makeCrackleCurve(AudioPipelineLayer.#crackle);
    }
    if (crackleMix) {
      crackleMix.gain.value = 1;
    }
  }

  static setVoiceSpeed(value) {
    AudioPipelineLayer.#assertReady();
    AudioPipelineLayer.#voiceSpeed = Math.max(0.5, Math.min(3, value));
    if (AudioPipelineLayer.#voiceSpeed === 1) {
      AudioPipelineLayer.#ringWrite = 0;
      AudioPipelineLayer.#ringRead = 0;
    }
  }

  static setSaturation(value) {
    AudioPipelineLayer.#assertReady();
    AudioPipelineLayer.#saturation = Math.max(0, Math.min(100, value));
    const { distortionNode } = AudioPipelineLayer.#nodes;
    if (distortionNode) {
      distortionNode.curve = AudioPipelineLayer.#makeDistortionCurve(AudioPipelineLayer.#saturation);
    }
  }

  static setLfo(enabled, speed, depth, link) {
    AudioPipelineLayer.#assertReady();
    AudioPipelineLayer.#lfoEnabled = !!enabled;
    if (speed !== undefined) AudioPipelineLayer.#lfoSpeed = Math.max(0.1, Math.min(10, speed));
    if (depth !== undefined) AudioPipelineLayer.#lfoDepth = Math.max(0, Math.min(100, depth));
    if (link !== undefined) AudioPipelineLayer.#lfoLink = !!link;
    AudioPipelineLayer.#applyStereoControls();
  }

  static set8D(enabled, speed, depth) {
    AudioPipelineLayer.#assertReady();
    AudioPipelineLayer.#eightDEnabled = !!enabled;
    if (speed !== undefined) AudioPipelineLayer.#eightDSpeed = Math.max(0.1, Math.min(5, speed));
    if (depth !== undefined) AudioPipelineLayer.#eightDDepth = Math.max(0, Math.min(1, depth));
    if (AudioPipelineLayer.#eightDEnabled) {
      AudioPipelineLayer.#start8D();
    } else {
      AudioPipelineLayer.#stop8D();
    }
  }

  static getSettings() {
    AudioPipelineLayer.#assertReady();
    const { masterGain, micMix, musicMix } = AudioPipelineLayer.#nodes;
    return {
      masterGain:  masterGain.gain.value,
      musicVolume: musicMix.gain.value,
      micMuted:    micMix.gain.value === 0,
      stereoDelay: { left: AudioPipelineLayer.#leftVal, right: AudioPipelineLayer.#rightVal },
      stereoWidth: AudioPipelineLayer.#stereoWidth,
      volumeBoost: AudioPipelineLayer.#volumeBoost,
      crackle: AudioPipelineLayer.#crackle,
      crackleMix: AudioPipelineLayer.#crackleMix,
      exciter: AudioPipelineLayer.#exciterAmount,
      highShelf: AudioPipelineLayer.#highShelfGain,
      limiter: AudioPipelineLayer.#limiterThreshold,
      voiceSpeed: AudioPipelineLayer.#voiceSpeed,
      saturation: AudioPipelineLayer.#saturation,
      wtf: { time: AudioPipelineLayer.#wtfTime, mix: AudioPipelineLayer.#wtfDelay },
      lfo: { enabled: AudioPipelineLayer.#lfoEnabled, speed: AudioPipelineLayer.#lfoSpeed, depth: AudioPipelineLayer.#lfoDepth, link: AudioPipelineLayer.#lfoLink },
      eightD: { enabled: AudioPipelineLayer.#eightDEnabled, speed: AudioPipelineLayer.#eightDSpeed, depth: AudioPipelineLayer.#eightDDepth },
      bands: AudioPipelineLayer.#bands.map((b, i) => ({
        freq:    CFG.eq[i].freq,
        gain:    b.defaultGain,
        q:       b.node.Q.value,
        enabled: b.enabled,
      })),
    };
  }
}

class LocalAudioLayer {
  static #el           = null;
  static #srcNode      = null;
  static #gainNode     = null;
  static #muted        = false;
  static #volume       = 1;
  static #playbackRate = 1.0;

  static install() {
    LocalAudioLayer.#setup();
  }

  static #setup() {
    const ctx  = AudioPipelineLayer.getContext();
    const gain = ctx.createGain();
    gain.gain.value = LocalAudioLayer.#volume;
    AudioPipelineLayer.connectMusicSource(gain);
    LocalAudioLayer.#gainNode = gain;

    const el = new Audio();
    el.crossOrigin = 'anonymous';
    el.loop        = false;
    LocalAudioLayer.#el = el;

    const srcNode = ctx.createMediaElementSource(el);
    srcNode.connect(gain);
    LocalAudioLayer.#srcNode = srcNode;
  }

  static loadFile(file) {
    const url = URL.createObjectURL(file);
    LocalAudioLayer.#el.src = url;
    LocalAudioLayer.#el.load();
    LocalAudioLayer.#el.playbackRate = LocalAudioLayer.#playbackRate;
  }

  static play() {
    if (LocalAudioLayer.#el) {
      LocalAudioLayer.#el.playbackRate = LocalAudioLayer.#playbackRate;
      LocalAudioLayer.#el.play();
    }
  }

  static pause()            { LocalAudioLayer.#el?.pause(); }
  static stop()             { const el = LocalAudioLayer.#el; if (!el) return; el.pause(); el.currentTime = 0; }
  static seek(seconds)      { if (LocalAudioLayer.#el) LocalAudioLayer.#el.currentTime = seconds; }
  static setLoop(bool)      { if (LocalAudioLayer.#el) LocalAudioLayer.#el.loop = bool; }
  static isPlaying()        { return LocalAudioLayer.#el ? !LocalAudioLayer.#el.paused : false; }
  static currentTime()      { return LocalAudioLayer.#el?.currentTime ?? 0; }
  static duration()         { return LocalAudioLayer.#el?.duration ?? 0; }

  static setMusicVolume(value) {
    LocalAudioLayer.#volume = value;
    if (LocalAudioLayer.#gainNode) LocalAudioLayer.#gainNode.gain.value = value;
    AudioPipelineLayer.setMusicVolume(value);
  }

  static setPlaybackRate(value) {
    LocalAudioLayer.#playbackRate = Math.max(0.5, Math.min(3.0, value));
    if (LocalAudioLayer.#el) {
      LocalAudioLayer.#el.playbackRate = LocalAudioLayer.#playbackRate;
    }
  }

  static muteMusic(bool) {
    LocalAudioLayer.#muted = bool;
    if (LocalAudioLayer.#gainNode)
      LocalAudioLayer.#gainNode.gain.value = bool ? 0 : LocalAudioLayer.#volume;
  }

  static reset() {
    LocalAudioLayer.stop();
    LocalAudioLayer.setLoop(false);
    LocalAudioLayer.#muted = false;
    LocalAudioLayer.#volume = 1;
    LocalAudioLayer.#playbackRate = 1.0;
    if (LocalAudioLayer.#gainNode) LocalAudioLayer.#gainNode.gain.value = 1;
    if (LocalAudioLayer.#el) {
      LocalAudioLayer.#el.src = '';
      LocalAudioLayer.#el.load();
      LocalAudioLayer.#el.playbackRate = 1.0;
    }
    AudioPipelineLayer.setMusicVolume(1);
  }
}

class RTCLayer {
  static #PC  = RTCPeerConnection.prototype;
  static #RTP = RTCRtpSender.prototype;

  static install() {
    RTCLayer.#sdp();
    RTCLayer.#tracks();
    RTCLayer.#encoding();
  }

  static #sdp() {
    Interceptor.sync(RTCLayer.#PC, 'setLocalDescription',  (o, d) => sdpDesc(o, d));
    Interceptor.sync(RTCLayer.#PC, 'setRemoteDescription', (o, d) => sdpDesc(o, d));
    Interceptor.async_(RTCLayer.#PC, 'createOffer',  sdpResult);
    Interceptor.async_(RTCLayer.#PC, 'createAnswer', sdpResult);
  }

  static #tracks() {
    const orig = RTCLayer.#PC.addTrack;
    RTCLayer.#PC.addTrack = function (track, ...streams) {
      if (State.foreign(track)) track = State.outbound();
      const sender = orig.call(this, track, ...streams);
      BitrateLayer.apply(sender);
      return sender;
    };
    RTCLayer.#PC.addTrack.toString = () => orig.toString();

    Interceptor.async_(RTCLayer.#RTP, 'replaceTrack', async (o, t) => {
      const track = State.foreign(t) ? State.outbound() : t;
      const r = await o(track);
      BitrateLayer.apply(this);
      return r;
    });
  }

  static #encoding() {
    Interceptor.sync(RTCLayer.#PC, 'addTransceiver', function (o, tk, init = {}) {
      if (tk === 'audio' || tk?.kind === 'audio')
        init = { ...init, sendEncodings: BitrateLayer.encodings(init.sendEncodings) };
      const tr = o(tk, init);
      if (tk === 'audio' || tk?.kind === 'audio') BitrateLayer.apply(tr.sender);
      return tr;
    });

    Interceptor.sync(RTCLayer.#RTP, 'setParameters', function (o, p) {
      if (p?.encodings && this.track?.kind === 'audio')
        p = { ...p, encodings: BitrateLayer.encodings(p.encodings) };
      return o(p);
    });
  }
}

class WorkletLayer {
  static install() {
    const proto = AudioWorklet?.prototype;
    if (!proto?.addModule) return;
    Interceptor.async_(proto, 'addModule', (o, url, ...rest) => {
      const u = String(url);
      if (CFG.blocklist.some(w => u.includes(w))) return Promise.resolve();
      return o(url, ...rest);
    });
  }
}

class AudioCtxLayer {
  static #stereoize(node) {
    try {
      node.channelCount          = 2;
      node.channelCountMode      = 'explicit';
      node.channelInterpretation = 'discrete';
    } catch (_) {}
    return node;
  }

  static install() {
    const proto = AudioContext.prototype;
    Interceptor.sync(proto, 'createMediaStreamSource', (o, s) =>
      AudioCtxLayer.#stereoize(o(s))
    );
    Interceptor.sync(proto, 'createMediaStreamDestination', (o) =>
      AudioCtxLayer.#stereoize(o())
    );
  }
}

[BitrateLayer, MicLayer, TrackLayer, AudioPipelineLayer, LocalAudioLayer, RTCLayer, WorkletLayer, AudioCtxLayer]
  .forEach(m => m.install());

// ── Floating Control Panel ────────────────────────────────────────────────────
const UI = new class {
  #el       = null;
  #dragging = false;
  #dx = 0; #dy = 0;
  #micMuted = false;
  #musicMuted = false;

  build() {
    const s = document.createElement('style');
    s.textContent = `
      #dsm-panel{position:fixed;top:60px;right:16px;z-index:2147483647;width:320px;
        background:#111318e0;border:1px solid #2a2d36;border-radius:12px;
        font:12px/1.4 'gg sans','Noto Sans',sans-serif;color:#ccc;
        box-shadow:0 8px 32px #000a;user-select:none;backdrop-filter:blur(12px);
        max-height:90vh;overflow-y:auto;}
      #dsm-panel::-webkit-scrollbar{width:6px;}
      #dsm-panel::-webkit-scrollbar-track{background:transparent;}
      #dsm-panel::-webkit-scrollbar-thumb{background:#2a2d36;border-radius:3px;}
      #dsm-panel::-webkit-scrollbar-thumb:hover{background:#7289da;}
      #dsm-panel h2{margin:0;padding:10px 14px;font-size:11px;font-weight:700;
        letter-spacing:1px;text-transform:uppercase;color:#7289da;
        border-bottom:1px solid #1e2029;cursor:move;display:flex;justify-content:space-between;align-items:center;}
      #dsm-panel h2 span{font-size:9px;color:#555;font-weight:400;letter-spacing:0}
      #dsm-panel section{padding:10px 14px;border-bottom:1px solid #1e2029;}
      #dsm-panel label{display:flex;justify-content:space-between;align-items:center;
        gap:8px;margin-bottom:6px;font-size:11px;color:#aaa;}
      #dsm-panel input[type=range]{flex:1;accent-color:#7289da;height:3px;cursor:pointer;}
      #dsm-panel input[type=number]{width:72px;background:#1a1d24;border:1px solid #2a2d36;
        border-radius:4px;color:#fff;font-size:11px;padding:2px 6px;text-align:right;}
      #dsm-panel input[type=number]:focus{outline:none;border-color:#7289da;}
      #dsm-panel .row{display:flex;gap:6px;align-items:center;margin-bottom:6px;}
      #dsm-panel .mute{padding:2px 8px;border-radius:4px;border:1px solid #2a2d36;
        background:#1a1d24;color:#aaa;font-size:10px;cursor:pointer;}
      #dsm-panel .mute.on{background:#7289da22;border-color:#7289da;color:#7289da;}
      #dsm-panel .eq-grid{display:grid;grid-template-columns:repeat(30,1fr);gap:2px;align-items:end;height:140px;}
      #dsm-panel .eq-col{display:flex;flex-direction:column;align-items:center;gap:3px;height:100%;}
      #dsm-panel .eq-col input[type=range]{writing-mode:vertical-lr;direction:rtl;
        flex:1;width:16px;accent-color:#7289da;cursor:pointer;}
      #dsm-panel .eq-col span{font-size:8px;color:#555;white-space:nowrap;}
      #dsm-panel .eq-col .eq-val{font-size:8px;color:#7289da;min-width:24px;text-align:center;}
      #dsm-panel .sec-head{display:flex;justify-content:space-between;align-items:center;
        margin-bottom:8px;}
      #dsm-panel .sec-head span{font-weight:600;color:#7289da;font-size:10px;letter-spacing:.5px;}
      #dsm-panel .reset-sm{padding:2px 8px;border-radius:4px;border:1px solid #2a2d36;
        background:#1a1d24;color:#aaa;font-size:9px;cursor:pointer;flex-shrink:0;}
      #dsm-panel .reset-sm:hover{border-color:#7289da;color:#7289da;}
      #dsm-panel .reset{width:100%;padding:4px;background:#1a1d24;border:1px solid #2a2d36;
        border-radius:4px;color:#aaa;font-size:10px;cursor:pointer;margin-top:4px;}
      #dsm-panel .reset:hover{border-color:#7289da;color:#7289da;}
      #dsm-panel .player{display:flex;flex-direction:column;gap:6px;}
      #dsm-panel .player-title{font-size:10px;color:#7289da;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center;padding:2px 0;}
      #dsm-panel .player-btns{display:flex;gap:4px;justify-content:center;}
      #dsm-panel .pb{padding:4px 10px;border-radius:4px;border:1px solid #2a2d36;background:#1a1d24;
        color:#ccc;font-size:11px;cursor:pointer;transition:border-color .15s,color .15s;}
      #dsm-panel .pb:hover{border-color:#7289da;color:#7289da;}
      #dsm-panel .pb.active{background:#7289da22;border-color:#7289da;color:#7289da;}
      #dsm-panel .player-seek{display:flex;align-items:center;gap:6px;font-size:9px;color:#555;}
      #dsm-panel .player-seek input{flex:1;accent-color:#7289da;height:3px;cursor:pointer;}
      #dsm-panel .player-file{display:none;}
      #dsm-panel .pick-file{width:100%;padding:4px;background:#1a1d24;border:1px solid #2a2d36;
        border-radius:4px;color:#aaa;font-size:10px;cursor:pointer;text-align:center;}
      #dsm-panel .pick-file:hover{border-color:#7289da;color:#7289da;}
    `;
    document.head.appendChild(s);

    const p = document.createElement('div');
    p.id = 'dsm-panel';
    p.innerHTML = `
      <h2><img src="data:image/png;base64,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" style="height:14px;width:auto;vertical-align:middle;margin-right:6px">Left And Right Voice <span>drag to move</span></h2>
      <section>
        <div class="sec-head"><span>VOLUME</span><button class="reset-sm" id="dsm-reset-vol">Reset</button></div>
        <div class="row">
          <label style="flex:1;margin:0">Master
            <input type="range" id="dsm-mg" min="0" max="100" step="0.01" value="1">
            <input type="number" id="dsm-mg-n" value="1" step="0.1">
          </label>
          <button class="mute" id="dsm-mm">Mute</button>
        </div>
      </section>
      
      <section>
        <div class="sec-head"><span>SES KALİTESİ</span><button class="reset-sm" id="dsm-reset-bass">Reset</button></div>
        <label>Ses Yükseltme
          <input type="range" id="dsm-bb" min="1" max="60" step="0.05" value="1">
          <input type="number" id="dsm-bb-n" min="1" max="60" step="0.1" value="1">
        </label>
        <div style="font-size:9px;color:#555;margin:-2px 0 6px">Düz ses artışı (1 = normal, 12 = max)</div>
        <label>Harmonic Exciter
          <input type="range" id="dsm-exciter" min="0" max="100" step="1" value="0">
          <input type="number" id="dsm-exciter-n" min="0" max="100" step="1" value="0">
        </label>
        <div style="font-size:9px;color:#555;margin:-2px 0 6px">Yüksek frekans parlaklığı (0 = kapalı, 100 = max)</div>
        <label>High Shelf (Clarity)
          <input type="range" id="dsm-highshelf" min="0" max="24" step="0.5" value="0">
          <input type="number" id="dsm-highshelf-n" min="0" max="24" step="0.5" value="0">
        </label>
        <div style="font-size:9px;color:#555;margin:-2px 0 6px">Yüksek frekans netliği (0 = normal, 12 = max)</div>
        <label>Limiter Threshold
          <input type="range" id="dsm-limiter" min="-20" max="0" step="0.5" value="-3">
          <input type="number" id="dsm-limiter-n" min="-20" max="0" step="0.5" value="-3">
        </label>
        <div style="font-size:9px;color:#555;margin:-2px 0 6px">Clipping koruması (-20 = çok koruma, 0 = kapalı)</div>
        <label>Cızırtı (Crackle)
          <input type="range" id="dsm-crz" min="0" max="100" step="1" value="0">
          <input type="number" id="dsm-crz-n" min="0" max="100" step="1" value="0">
        </label>
        <div style="font-size:9px;color:#555;margin:-2px 0 6px">Çok güçlü cızırtı efekti (0 = kapalı, 100 = max)</div>
      </section>

      <section>
        <div class="sec-head"><span>WTF EFEKTİ</span><button class="reset-sm" id="dsm-reset-wtf">Reset</button></div>
        <label>Delay Time (ms)
          <input type="range" id="dsm-wtf-time" min="0" max="2000" step="10" value="0">
          <input type="number" id="dsm-wtf-time-n" min="0" max="2000" step="10" value="0">
        </label>
        <label>Mix
          <input type="range" id="dsm-wtf-mix" min="0" max="100" step="1" value="0">
          <input type="number" id="dsm-wtf-mix-n" min="0" max="100" step="1" value="0">
        </label>
        <button class="reset" id="dsm-wtf-trigger" style="margin-top:8px">🎯 TRIGGER WTF</button>
        <div style="font-size:9px;color:#555;margin-top:2px">Tek seferlik echo - tetikle ve çalıştır</div>
      </section>

      <section>
        <div class="sec-head"><span>STEREO CONTROLS</span><button class="reset-sm" id="dsm-reset-delay">Reset</button></div>
        <label>Left Channel
          <input type="range" id="dsm-dl" min="0" max="100" step="1" value="0">
          <input type="number" id="dsm-dl-n" min="0" max="100" step="1" value="0">
        </label>
        <label>Right Channel
          <input type="range" id="dsm-dr" min="0" max="100" step="1" value="0">
          <input type="number" id="dsm-dr-n" min="0" max="100" step="1" value="0">
        </label>
        <label>Stereo Genişlik
          <input type="range" id="dsm-sw" min="0" max="100" step="1" value="0">
          <input type="number" id="dsm-sw-n" min="0" max="100" step="1" value="0">
        </label>
        <div style="font-size:9px;color:#555;margin-top:2px">0 = Merkez · 100 = Max (250ms) + Pan + Haas + M/S genişlik</div>
      </section>

      <section>
        <div class="sec-head">
          <span>8D AUDIO</span>
          <div style="display:flex;gap:4px;align-items:center;">
            <button class="mute" id="dsm-8d-toggle" style="padding:2px 6px;margin:0">Enable</button>
            <button class="reset-sm" id="dsm-reset-8d">Reset</button>
          </div>
        </div>
        <label>Rotation Speed
          <input type="range" id="dsm-8d-speed" min="0.1" max="5" step="0.1" value="1">
          <input type="number" id="dsm-8d-speed-n" min="0.1" max="5" step="0.1" value="1">
        </label>
        <label>Rotation Depth
          <input type="range" id="dsm-8d-depth" min="0" max="1" step="0.05" value="1">
          <input type="number" id="dsm-8d-depth-n" min="0" max="1" step="0.05" value="1">
        </label>
        <div style="font-size:9px;color:#555;margin-top:2px">Sesin kulaklarınızın etrafında dolaşma hızı ve derinliği</div>
      </section>

      <section>
        <div class="sec-head">
          <span>AUTO-PAN (LFO)</span>
          <div style="display:flex;gap:4px;align-items:center;">
            <button class="mute" id="dsm-lfo-toggle" style="padding:2px 6px;margin:0">Enable</button>
            <button class="reset-sm" id="dsm-reset-lfo">Reset</button>
          </div>
        </div>
        <div class="row" style="margin-bottom:6px">
          <label style="font-size:10px;color:#888;display:flex;align-items:center;gap:4px;cursor:pointer;margin:0">
            <input type="checkbox" id="dsm-lfo-link" checked style="accent-color:#7289da"> Link LFO to L/R Sliders
          </label>
        </div>
        <label>LFO Speed
          <input type="range" id="dsm-lfo-sp" min="0.1" max="10" step="0.1" value="1.5">
          <input type="number" id="dsm-lfo-sp-n" min="0.1" max="10" step="0.1" value="1.5">
        </label>
        <label id="dsm-lfo-dp-container">LFO Depth
          <input type="range" id="dsm-lfo-dp" min="0" max="100" step="1" value="0">
          <input type="number" id="dsm-lfo-dp-n" min="0" max="100" step="1" value="0">
        </label>
      </section>

      <section>
        <div class="sec-head">
          <span>EQ — 30 BAND</span>
          <div style="display:flex;gap:4px;align-items:center;">
            <select id="dsm-eq-preset" style="background:#1a1d24;border:1px solid #2a2d36;border-radius:4px;color:#fff;font-size:9px;padding:2px 6px;cursor:pointer;">
              <option value="flat">Flat</option>
              <option value="bass-boost">Bass Boost</option>
              <option value="vocal">Vocal Boost</option>
              <option value="music">Music</option>
              <option value="treble">Treble Boost</option>
              <option value="loud">Loud</option>
            </select>
            <button class="reset-sm" id="dsm-eqr">Reset EQ</button>
          </div>
        </div>
        <div class="eq-grid" id="dsm-eq"></div>
      </section>
      
      <section>
        <div class="sec-head"><span>MUSIC PLAYER</span><button class="reset-sm" id="dsm-reset-music">Reset</button></div>
        <div class="player">
          <button class="pick-file" id="dsm-pick">Load File (supports mp3, flac, etc)</button>
          <input class="player-file" type="file" id="dsm-file" accept=".mp3,.wav,.flac,.aac,.ogg,.m4a">
          <div class="player-title" id="dsm-track">No file loaded</div>
          <div class="player-seek">
            <span id="dsm-cur">0:00</span>
            <input type="range" id="dsm-seek" min="0" max="100" step="0.1" value="0">
            <span id="dsm-dur">0:00</span>
          </div>
          <div class="player-btns">
            <button class="pb" id="dsm-play">&#9654;</button>
            <button class="pb" id="dsm-pause">&#9646;&#9646;</button>
            <button class="pb" id="dsm-stop">&#9632;</button>
            <button class="pb" id="dsm-loop">&#8635; Loop</button>
          </div>
          <label style="margin-top:4px">Müzik Hızı
            <input type="range" id="dsm-msp" min="0.5" max="3" step="0.05" value="1">
            <input type="number" id="dsm-msp-n" min="0.5" max="3" step="0.05" value="1">
          </label>
          <label style="margin-top:4px">Music Vol
            <input type="range" id="dsm-mvol" min="0" max="10" step="0.01" value="1">
            <input type="number" id="dsm-mvol-n" value="1" step="0.1">
          </label>
          <div class="row">
            <button class="mute" id="dsm-mum2" style="flex:1;text-align:center">Mute Music</button>
          </div>
        </div>
      </section>
      <section style="border-bottom:none">
        <div class="row" style="gap:8px">
          <button class="reset" id="dsm-save-settings" style="flex:1">💾 Save Settings</button>
          <button class="reset" id="dsm-load-settings" style="flex:1">📂 Load Settings</button>
        </div>
        <button class="reset" id="dsm-reset-all" style="margin-top:8px">Reset All</button>
      </section>
    `;
    document.body.appendChild(p);
    this.#el = p;
    this.#drag(p.querySelector('h2'));
    this.#bindVolumes();
    this.#bindBassAndCrunch();
    this.#bindWTF();
    this.#bindStereoDelay();
    this.#bind8D();
    this.#bindLFO();
    this.#buildEQ();
    this.#bindMutes();
    this.#buildPlayer();
    this.#bindSectionResets();
    this.#bindResetAll();
    this.#bindSaveLoad();
  }

  #drag(handle) {
    handle.addEventListener('mousedown', e => {
      this.#dragging = true;
      const r = this.#el.getBoundingClientRect();
      this.#dx = e.clientX - r.left;
      this.#dy = e.clientY - r.top;
    });
    document.addEventListener('mousemove', e => {
      if (!this.#dragging) return;
      this.#el.style.right = 'auto';
      this.#el.style.left  = (e.clientX - this.#dx) + 'px';
      this.#el.style.top   = (e.clientY - this.#dy) + 'px';
    });
    document.addEventListener('mouseup', () => { this.#dragging = false; });
  }

  #linkVolume(sliderId, numberId, setter) {
    const sl = document.getElementById(sliderId);
    const nb = document.getElementById(numberId);
    const apply = (v) => {
      const n = Math.max(0, parseFloat(v) || 0);
      sl.value = Math.min(n, parseFloat(sl.max));
      nb.value = n;
      setter(n);
    };
    sl.addEventListener('input',  () => apply(sl.value));
    nb.addEventListener('change', () => apply(nb.value));
    nb.addEventListener('keydown', e => { if (e.key === 'Enter') apply(nb.value); });
  }

  #bindVolumes() {
    this.#linkVolume('dsm-mg', 'dsm-mg-n', v => AudioPipelineLayer.setMasterGain(v));
  }

  #bindBassAndCrunch() {
    const applyBoost = (v) => {
      const n = Math.max(1, Math.min(60, parseFloat(v) || 1));
      document.getElementById('dsm-bb').value = n;
      document.getElementById('dsm-bb-n').value = n;
      AudioPipelineLayer.setVolumeBoost(n);
    };
    document.getElementById('dsm-bb').addEventListener('input', () => applyBoost(document.getElementById('dsm-bb').value));
    document.getElementById('dsm-bb-n').addEventListener('change', () => applyBoost(document.getElementById('dsm-bb-n').value));
    this.#linkVolume('dsm-exciter', 'dsm-exciter-n', v => AudioPipelineLayer.setExciter(v));
    this.#linkVolume('dsm-highshelf', 'dsm-highshelf-n', v => AudioPipelineLayer.setHighShelf(v));
    this.#linkVolume('dsm-limiter', 'dsm-limiter-n', v => AudioPipelineLayer.setLimiter(v));
    this.#linkVolume('dsm-crz', 'dsm-crz-n', v => AudioPipelineLayer.setCrackle(v));
  }

  #bindWTF() {
    const applyTime = (v) => {
      const n = Math.max(0, Math.min(2000, parseFloat(v) || 0));
      document.getElementById('dsm-wtf-time').value = n;
      document.getElementById('dsm-wtf-time-n').value = n;
      const mix = parseFloat(document.getElementById('dsm-wtf-mix').value) || 0;
      AudioPipelineLayer.setWTF(n, mix);
    };
    const applyMix = (v) => {
      const n = Math.max(0, Math.min(100, parseFloat(v) || 0));
      document.getElementById('dsm-wtf-mix').value = n;
      document.getElementById('dsm-wtf-mix-n').value = n;
      const time = parseFloat(document.getElementById('dsm-wtf-time').value) || 0;
      AudioPipelineLayer.setWTF(time, n);
    };
    document.getElementById('dsm-wtf-time').addEventListener('input', () => applyTime(document.getElementById('dsm-wtf-time').value));
    document.getElementById('dsm-wtf-time-n').addEventListener('change', () => applyTime(document.getElementById('dsm-wtf-time-n').value));
    document.getElementById('dsm-wtf-mix').addEventListener('input', () => applyMix(document.getElementById('dsm-wtf-mix').value));
    document.getElementById('dsm-wtf-mix-n').addEventListener('change', () => applyMix(document.getElementById('dsm-wtf-mix-n').value));
    
    document.getElementById('dsm-wtf-trigger').addEventListener('click', () => {
      const time = parseFloat(document.getElementById('dsm-wtf-time').value) || 500;
      const mix = parseFloat(document.getElementById('dsm-wtf-mix').value) || 50;
      AudioPipelineLayer.setWTF(time, mix);
      AudioPipelineLayer.triggerWTF();
    });
  }


  #linkDelay(sliderId, numberId, side) {
    const sl = document.getElementById(sliderId);
    const nb = document.getElementById(numberId);
    const apply = (v) => {
      const n = Math.max(0, Math.min(100, parseInt(v, 10) || 0));
      sl.value = n;
      nb.value = n;
      const left  = side === 'left'  ? n : parseInt(document.getElementById('dsm-dl').value, 10);
      const right = side === 'right' ? n : parseInt(document.getElementById('dsm-dr').value, 10);
      AudioPipelineLayer.setStereoDelay(left, right);
      
      const lfoLink = document.getElementById('dsm-lfo-link').checked;
      if (lfoLink) {
        const overlap = Math.min(left, right);
        const dpSl = document.getElementById('dsm-lfo-dp');
        const dpNb = document.getElementById('dsm-lfo-dp-n');
        if (dpSl && dpNb) {
          dpSl.value = overlap;
          dpNb.value = overlap;
        }
      }
    };
    sl.addEventListener('input',  () => apply(sl.value));
    nb.addEventListener('change', () => apply(nb.value));
    nb.addEventListener('keydown', e => { if (e.key === 'Enter') apply(nb.value); });
  }

  #bindStereoDelay() {
    this.#linkDelay('dsm-dl', 'dsm-dl-n', 'left');
    this.#linkDelay('dsm-dr', 'dsm-dr-n', 'right');
    this.#linkVolume('dsm-sw', 'dsm-sw-n', v => AudioPipelineLayer.setStereoWidth(v));
  }

  #bindLFO() {
    const toggle = document.getElementById('dsm-lfo-toggle');
    const link = document.getElementById('dsm-lfo-link');
    const spSl = document.getElementById('dsm-lfo-sp');
    const spNb = document.getElementById('dsm-lfo-sp-n');
    const dpSl = document.getElementById('dsm-lfo-dp');
    const dpNb = document.getElementById('dsm-lfo-dp-n');
    const dpContainer = document.getElementById('dsm-lfo-dp-container');

    const updateLfo = () => {
      const enabled = toggle.classList.contains('on');
      const speed = parseFloat(spSl.value) || 1.5;
      const depth = parseFloat(dpSl.value) || 0;
      const isLinked = link.checked;
      
      AudioPipelineLayer.setLfo(enabled, speed, depth, isLinked);
    };

    toggle.addEventListener('click', () => {
      const enabled = !toggle.classList.contains('on');
      toggle.classList.toggle('on', enabled);
      toggle.textContent = enabled ? 'Disable' : 'Enable';
      updateLfo();
    });

    link.addEventListener('change', () => {
      const isLinked = link.checked;
      if (isLinked) {
        dpSl.disabled = true;
        dpNb.disabled = true;
        dpContainer.style.opacity = 0.5;
        const left = parseInt(document.getElementById('dsm-dl').value, 10) || 0;
        const right = parseInt(document.getElementById('dsm-dr').value, 10) || 0;
        const overlap = Math.min(left, right);
        dpSl.value = overlap;
        dpNb.value = overlap;
      } else {
        dpSl.disabled = false;
        dpNb.disabled = false;
        dpContainer.style.opacity = 1.0;
      }
      updateLfo();
    });

    if (link.checked) {
      dpSl.disabled = true;
      dpNb.disabled = true;
      dpContainer.style.opacity = 0.5;
    }

    const applySpeed = (v) => {
      const n = Math.max(0.1, Math.min(10, parseFloat(v) || 1.5));
      spSl.value = n;
      spNb.value = n;
      updateLfo();
    };
    spSl.addEventListener('input', () => applySpeed(spSl.value));
    spNb.addEventListener('change', () => applySpeed(spNb.value));
    spNb.addEventListener('keydown', e => { if (e.key === 'Enter') applySpeed(spNb.value); });

    const applyDepth = (v) => {
      if (link.checked) return;
      const n = Math.max(0, Math.min(100, parseFloat(v) || 0));
      dpSl.value = n;
      dpNb.value = n;
      updateLfo();
    };
    dpSl.addEventListener('input', () => applyDepth(dpSl.value));
    dpNb.addEventListener('change', () => applyDepth(dpNb.value));
    dpNb.addEventListener('keydown', e => { if (e.key === 'Enter') applyDepth(dpNb.value); });
  }

  #bind8D() {
    const toggle = document.getElementById('dsm-8d-toggle');
    const spSl = document.getElementById('dsm-8d-speed');
    const spNb = document.getElementById('dsm-8d-speed-n');
    const dpSl = document.getElementById('dsm-8d-depth');
    const dpNb = document.getElementById('dsm-8d-depth-n');

    const update8D = () => {
      const enabled = toggle.classList.contains('on');
      const speed = parseFloat(spSl.value) || 1;
      const depth = parseFloat(dpSl.value) || 1;
      AudioPipelineLayer.set8D(enabled, speed, depth);
    };

    toggle.addEventListener('click', () => {
      const enabled = !toggle.classList.contains('on');
      toggle.classList.toggle('on', enabled);
      toggle.textContent = enabled ? 'Disable' : 'Enable';
      update8D();
    });

    const applySpeed = (v) => {
      const n = Math.max(0.1, Math.min(5, parseFloat(v) || 1));
      spSl.value = n;
      spNb.value = n;
      update8D();
    };
    spSl.addEventListener('input', () => applySpeed(spSl.value));
    spNb.addEventListener('change', () => applySpeed(spNb.value));
    spNb.addEventListener('keydown', e => { if (e.key === 'Enter') applySpeed(spNb.value); });

    const applyDepth = (v) => {
      const n = Math.max(0, Math.min(1, parseFloat(v) || 1));
      dpSl.value = n;
      dpNb.value = n;
      update8D();
    };
    dpSl.addEventListener('input', () => applyDepth(dpSl.value));
    dpNb.addEventListener('change', () => applyDepth(dpNb.value));
    dpNb.addEventListener('keydown', e => { if (e.key === 'Enter') applyDepth(dpNb.value); });

    document.getElementById('dsm-reset-8d').addEventListener('click', () => {
      toggle.classList.remove('on');
      toggle.textContent = 'Enable';
      spSl.value = 1;
      spNb.value = 1;
      dpSl.value = 1;
      dpNb.value = 1;
      AudioPipelineLayer.set8D(false, 1, 1);
    });
  }

  #bindMutes() {
    const mm = document.getElementById('dsm-mm');
    mm.addEventListener('click', () => {
      this.#micMuted = !this.#micMuted;
      AudioPipelineLayer.muteMic(this.#micMuted);
      mm.textContent = this.#micMuted ? 'Unmute' : 'Mute';
      mm.classList.toggle('on', this.#micMuted);
    });
  }

  #fmt(s) {
    const m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2,'0')}`;
  }

  #buildPlayer() {
    let looping = false, seeking = false;

    const pick   = document.getElementById('dsm-pick');
    const file   = document.getElementById('dsm-file');
    const track  = document.getElementById('dsm-track');
    const seekEl = document.getElementById('dsm-seek');
    const curEl  = document.getElementById('dsm-cur');
    const durEl  = document.getElementById('dsm-dur');
    const playB  = document.getElementById('dsm-play');
    const pauseB = document.getElementById('dsm-pause');
    const stopB  = document.getElementById('dsm-stop');
    const loopB  = document.getElementById('dsm-loop');
    const mum    = document.getElementById('dsm-mum2');
    const volSl  = document.getElementById('dsm-mvol');
    const volNb  = document.getElementById('dsm-mvol-n');

    pick.addEventListener('click', () => {
      const ctx = AudioPipelineLayer.getContext();
      if (ctx.state === 'suspended') ctx.resume();
      file.click();
    });
    file.addEventListener('change', () => {
      const f = file.files[0];
      if (!f) return;
      LocalAudioLayer.loadFile(f);
      track.textContent = f.name;
      seekEl.value = 0;
      curEl.textContent = '0:00';
    });

    playB.addEventListener('click',  () => {
      const ctx = AudioPipelineLayer.getContext();
      if (ctx.state === 'suspended') ctx.resume();
      LocalAudioLayer.play();
      playB.classList.add('active');
    });
    pauseB.addEventListener('click', () => { LocalAudioLayer.pause(); playB.classList.remove('active'); });
    stopB.addEventListener('click',  () => { LocalAudioLayer.stop();  playB.classList.remove('active'); seekEl.value = 0; curEl.textContent = '0:00'; });

    loopB.addEventListener('click', () => {
      looping = !looping;
      LocalAudioLayer.setLoop(looping);
      loopB.classList.toggle('active', looping);
    });

    seekEl.addEventListener('mousedown', () => { seeking = true; });
    seekEl.addEventListener('mouseup',   () => {
      LocalAudioLayer.seek(parseFloat(seekEl.value));
      seeking = false;
    });

    mum.addEventListener('click', () => {
      this.#musicMuted = !this.#musicMuted;
      LocalAudioLayer.muteMusic(this.#musicMuted);
      mum.textContent = this.#musicMuted ? 'Unmute Music' : 'Mute Music';
      mum.classList.toggle('on', this.#musicMuted);
    });

    const applyVol = (v) => {
      const n = Math.max(0, parseFloat(v) || 0);
      volSl.value = Math.min(n, 10);
      volNb.value = n;
      LocalAudioLayer.setMusicVolume(n);
    };
    volSl.addEventListener('input',   () => applyVol(volSl.value));
    volNb.addEventListener('change',  () => applyVol(volNb.value));
    volNb.addEventListener('keydown', e => { if (e.key === 'Enter') applyVol(volNb.value); });

    const mspSl = document.getElementById('dsm-msp');
    const mspNb = document.getElementById('dsm-msp-n');
    const applyMusicSpeed = (v) => {
      const n = Math.max(0.5, Math.min(3, parseFloat(v) || 1));
      mspSl.value = n;
      mspNb.value = n;
      LocalAudioLayer.setPlaybackRate(n);
    };
    mspSl.addEventListener('input', () => applyMusicSpeed(mspSl.value));
    mspNb.addEventListener('change', () => applyMusicSpeed(mspNb.value));
    mspNb.addEventListener('keydown', e => { if (e.key === 'Enter') applyMusicSpeed(mspNb.value); });

    setInterval(() => {
      const dur = LocalAudioLayer.duration();
      const cur = LocalAudioLayer.currentTime();
      if (!seeking && dur > 0) {
        seekEl.max = dur;
        seekEl.value = cur;
        curEl.textContent = this.#fmt(cur);
        durEl.textContent = this.#fmt(dur);
      }
      if (LocalAudioLayer.isPlaying()) playB.classList.add('active');
      else playB.classList.remove('active');
    }, 250);
  }

  #setUI(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val;
  }

  #resetEQUI() {
    for (let i = 0; i < 30; i++) {
      this.#setUI(`dsm-eq-${i}`, 0);
      const v = document.getElementById(`dsm-eq-v${i}`);
      if (v) v.textContent = '0';
    }
    AudioPipelineLayer.resetEQ();

    // Temiz tiz ses için hafif optimizasyon
    const cleanPreset = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 4, 5, 5, 6, 6, 6];
    cleanPreset.forEach((gain, i) => {
      AudioPipelineLayer.setBand(i, gain);
      const sl = document.getElementById(`dsm-eq-${i}`);
      const val = document.getElementById(`dsm-eq-v${i}`);
      if (sl && val) {
        sl.value = gain;
        val.textContent = (gain > 0 ? '+' : '') + gain.toFixed(1);
      }
    });
  }

  #bindSectionResets() {
    document.getElementById('dsm-reset-vol').addEventListener('click', () => {
      AudioPipelineLayer.setMasterGain(1);
      this.#setUI('dsm-mg', 1);
      this.#setUI('dsm-mg-n', 1);
    });

    document.getElementById('dsm-reset-bass').addEventListener('click', () => {
      AudioPipelineLayer.setVolumeBoost(1);
      AudioPipelineLayer.setExciter(0);
      AudioPipelineLayer.setHighShelf(0);
      AudioPipelineLayer.setLimiter(-3);
      AudioPipelineLayer.setCrackle(0);
      this.#setUI('dsm-bb', 1); this.#setUI('dsm-bb-n', 1);
      this.#setUI('dsm-exciter', 0); this.#setUI('dsm-exciter-n', 0);
      this.#setUI('dsm-highshelf', 0); this.#setUI('dsm-highshelf-n', 0);
      this.#setUI('dsm-limiter', -3); this.#setUI('dsm-limiter-n', -3);
      this.#setUI('dsm-crz', 0); this.#setUI('dsm-crz-n', 0);
    });

    document.getElementById('dsm-reset-wtf').addEventListener('click', () => {
      AudioPipelineLayer.setWTF(0, 0);
      this.#setUI('dsm-wtf-time', 0); this.#setUI('dsm-wtf-time-n', 0);
      this.#setUI('dsm-wtf-mix', 0); this.#setUI('dsm-wtf-mix-n', 0);
    });

    document.getElementById('dsm-reset-delay').addEventListener('click', () => {
      AudioPipelineLayer.setStereoDelay(0, 0);
      AudioPipelineLayer.setStereoWidth(0);
      this.#setUI('dsm-dl', 0); this.#setUI('dsm-dl-n', 0);
      this.#setUI('dsm-dr', 0); this.#setUI('dsm-dr-n', 0);
      this.#setUI('dsm-sw', 0); this.#setUI('dsm-sw-n', 0);
      if (document.getElementById('dsm-lfo-link').checked) {
        this.#setUI('dsm-lfo-dp', 0);
        this.#setUI('dsm-lfo-dp-n', 0);
      }
    });

    document.getElementById('dsm-reset-lfo').addEventListener('click', () => {
      const toggle = document.getElementById('dsm-lfo-toggle');
      toggle.classList.remove('on');
      toggle.textContent = 'Enable';
      
      const link = document.getElementById('dsm-lfo-link');
      link.checked = true;
      
      const dpSl = document.getElementById('dsm-lfo-dp');
      const dpNb = document.getElementById('dsm-lfo-dp-n');
      const dpContainer = document.getElementById('dsm-lfo-dp-container');
      dpSl.disabled = true;
      dpNb.disabled = true;
      dpContainer.style.opacity = 0.5;

      this.#setUI('dsm-lfo-sp', 1.5);
      this.#setUI('dsm-lfo-sp-n', 1.5);
      
      const left = parseInt(document.getElementById('dsm-dl').value, 10) || 0;
      const right = parseInt(document.getElementById('dsm-dr').value, 10) || 0;
      const overlap = Math.min(left, right);
      this.#setUI('dsm-lfo-dp', overlap);
      this.#setUI('dsm-lfo-dp-n', overlap);

      AudioPipelineLayer.setLfo(false, 1.5, overlap, true);
    });

    document.getElementById('dsm-eqr').addEventListener('click', () => {
      this.#resetEQUI();
    });

    document.getElementById('dsm-reset-music').addEventListener('click', () => {
      this.#musicMuted = false;
      LocalAudioLayer.setMusicVolume(1);
      LocalAudioLayer.setPlaybackRate(1);
      LocalAudioLayer.muteMusic(false);
      this.#setUI('dsm-mvol', 1);
      this.#setUI('dsm-mvol-n', 1);
      this.#setUI('dsm-msp', 1);
      this.#setUI('dsm-msp-n', 1);
      const mum = document.getElementById('dsm-mum2');
      mum.textContent = 'Mute Music';
      mum.classList.remove('on');
    });
  }

  #bindResetAll() {
    document.getElementById('dsm-reset-all').addEventListener('click', () => {
      this.#micMuted = false;
      this.#musicMuted = false;
      AudioPipelineLayer.resetAll();
      LocalAudioLayer.reset();

      this.#setUI('dsm-mg', 1); this.#setUI('dsm-mg-n', 1);
      this.#setUI('dsm-dl', 0); this.#setUI('dsm-dl-n', 0);
      this.#setUI('dsm-dr', 0); this.#setUI('dsm-dr-n', 0);
      this.#setUI('dsm-sw', 0); this.#setUI('dsm-sw-n', 0);
      this.#setUI('dsm-bb', 1); this.#setUI('dsm-bb-n', 1);
      this.#setUI('dsm-exciter', 0); this.#setUI('dsm-exciter-n', 0);
      this.#setUI('dsm-highshelf', 0); this.#setUI('dsm-highshelf-n', 0);
      this.#setUI('dsm-limiter', -3); this.#setUI('dsm-limiter-n', -3);
      this.#setUI('dsm-crz', 0); this.#setUI('dsm-crz-n', 0);
      this.#setUI('dsm-wtf-time', 0); this.#setUI('dsm-wtf-time-n', 0);
      this.#setUI('dsm-wtf-mix', 0); this.#setUI('dsm-wtf-mix-n', 0);
      
      const lfoToggle = document.getElementById('dsm-lfo-toggle');
      lfoToggle.classList.remove('on');
      lfoToggle.textContent = 'Enable';
      
      const lfoLink = document.getElementById('dsm-lfo-link');
      lfoLink.checked = true;
      
      const dpSl = document.getElementById('dsm-lfo-dp');
      const dpNb = document.getElementById('dsm-lfo-dp-n');
      const dpContainer = document.getElementById('dsm-lfo-dp-container');
      dpSl.disabled = true;
      dpNb.disabled = true;
      dpContainer.style.opacity = 0.5;

      this.#setUI('dsm-lfo-sp', 1.5); this.#setUI('dsm-lfo-sp-n', 1.5);
      this.#setUI('dsm-lfo-dp', 0); this.#setUI('dsm-lfo-dp-n', 0);

      const eightDToggle = document.getElementById('dsm-8d-toggle');
      eightDToggle.classList.remove('on');
      eightDToggle.textContent = 'Enable';
      this.#setUI('dsm-8d-speed', 1); this.#setUI('dsm-8d-speed-n', 1);
      this.#setUI('dsm-8d-depth', 1); this.#setUI('dsm-8d-depth-n', 1);

      this.#setUI('dsm-mvol', 1); this.#setUI('dsm-mvol-n', 1);
      this.#setUI('dsm-msp', 1); this.#setUI('dsm-msp-n', 1);
      this.#setUI('dsm-seek', 0);
      this.#resetEQUI();

      const mm = document.getElementById('dsm-mm');
      mm.textContent = 'Mute';
      mm.classList.remove('on');

      const mum = document.getElementById('dsm-mum2');
      mum.textContent = 'Mute Music';
      mum.classList.remove('on');

      document.getElementById('dsm-track').textContent = 'No file loaded';
      document.getElementById('dsm-cur').textContent = '0:00';
      document.getElementById('dsm-dur').textContent = '0:00';
    });
  }

  #bindSaveLoad() {
    document.getElementById('dsm-save-settings').addEventListener('click', () => {
      this.#saveSettings();
    });

    document.getElementById('dsm-load-settings').addEventListener('click', () => {
      this.#loadSettings();
    });
  }

  #saveSettings() {
    const settings = AudioPipelineLayer.getSettings();
    const settingsJSON = JSON.stringify(settings, null, 2);
    const blob = new Blob([settingsJSON], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'stereodiscord-settings.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  #loadSettings() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const settings = JSON.parse(event.target.result);
          if (!settings || typeof settings !== 'object') {
            throw new Error('Geçersiz ayar formatı');
          }
          this.#applySettings(settings);
          alert('Ayarlar başarıyla yüklendi!');
        } catch (err) {
          console.error('Settings load error:', err);
          alert('Ayar dosyası yüklenemedi: ' + err.message);
        }
      };
      reader.onerror = () => {
        alert('Dosya okunurken hata oluştu');
      };
      reader.readAsText(file);
    };
    input.click();
  }

  #applySettings(settings) {
    try {
      if (settings.masterGain !== undefined) {
        AudioPipelineLayer.setMasterGain(settings.masterGain);
        this.#setUI('dsm-mg', settings.masterGain);
        this.#setUI('dsm-mg-n', settings.masterGain);
      }
      if (settings.musicVolume !== undefined) {
        AudioPipelineLayer.setMusicVolume(settings.musicVolume);
        this.#setUI('dsm-mv', settings.musicVolume);
        this.#setUI('dsm-mv-n', settings.musicVolume);
      }
      if (settings.micMuted !== undefined) {
        this.#micMuted = settings.micMuted;
        AudioPipelineLayer.muteMic(settings.micMuted);
        const mm = document.getElementById('dsm-mm');
        mm.textContent = settings.micMuted ? 'Unmute' : 'Mute';
        mm.classList.toggle('on', settings.micMuted);
      }
      if (settings.stereoDelay) {
        AudioPipelineLayer.setStereoDelay(settings.stereoDelay.left, settings.stereoDelay.right);
        this.#setUI('dsm-dl', settings.stereoDelay.left);
        this.#setUI('dsm-dl-n', settings.stereoDelay.left);
        this.#setUI('dsm-dr', settings.stereoDelay.right);
        this.#setUI('dsm-dr-n', settings.stereoDelay.right);
      }
      if (settings.stereoWidth !== undefined) {
        AudioPipelineLayer.setStereoWidth(settings.stereoWidth);
        this.#setUI('dsm-sw', settings.stereoWidth);
        this.#setUI('dsm-sw-n', settings.stereoWidth);
      }
      if (settings.volumeBoost !== undefined) {
        AudioPipelineLayer.setVolumeBoost(settings.volumeBoost);
        this.#setUI('dsm-bb', settings.volumeBoost);
        this.#setUI('dsm-bb-n', settings.volumeBoost);
      }
      if (settings.exciter !== undefined) {
        AudioPipelineLayer.setExciter(settings.exciter);
        this.#setUI('dsm-exciter', settings.exciter);
        this.#setUI('dsm-exciter-n', settings.exciter);
      }
      if (settings.highShelf !== undefined) {
        AudioPipelineLayer.setHighShelf(settings.highShelf);
        this.#setUI('dsm-highshelf', settings.highShelf);
        this.#setUI('dsm-highshelf-n', settings.highShelf);
      }
      if (settings.limiter !== undefined) {
        AudioPipelineLayer.setLimiter(settings.limiter);
        this.#setUI('dsm-limiter', settings.limiter);
        this.#setUI('dsm-limiter-n', settings.limiter);
      }
      if (settings.crackle !== undefined) {
        AudioPipelineLayer.setCrackle(settings.crackle);
        this.#setUI('dsm-crz', settings.crackle);
        this.#setUI('dsm-crz-n', settings.crackle);
      }
      if (settings.wtf) {
        AudioPipelineLayer.setWTF(settings.wtf.time, settings.wtf.mix);
        this.#setUI('dsm-wtf-time', settings.wtf.time);
        this.#setUI('dsm-wtf-time-n', settings.wtf.time);
        this.#setUI('dsm-wtf-mix', settings.wtf.mix);
        this.#setUI('dsm-wtf-mix-n', settings.wtf.mix);
      }
      if (settings.lfo) {
        AudioPipelineLayer.setLfo(settings.lfo.enabled, settings.lfo.speed, settings.lfo.depth, settings.lfo.link);
        this.#setUI('dsm-lfo-sp', settings.lfo.speed);
        this.#setUI('dsm-lfo-sp-n', settings.lfo.speed);
        this.#setUI('dsm-lfo-dp', settings.lfo.depth);
        this.#setUI('dsm-lfo-dp-n', settings.lfo.depth);
        if (settings.lfo.enabled) {
          const lfoToggle = document.getElementById('dsm-lfo-toggle');
          lfoToggle.classList.add('on');
          lfoToggle.textContent = 'Disable';
        }
        if (settings.lfo.link !== undefined) {
          document.getElementById('dsm-lfo-link').checked = settings.lfo.link;
        }
      }
      if (settings.eightD) {
        AudioPipelineLayer.set8D(settings.eightD.enabled, settings.eightD.speed, settings.eightD.depth);
        this.#setUI('dsm-8d-speed', settings.eightD.speed);
        this.#setUI('dsm-8d-speed-n', settings.eightD.speed);
        this.#setUI('dsm-8d-depth', settings.eightD.depth);
        this.#setUI('dsm-8d-depth-n', settings.eightD.depth);
        if (settings.eightD.enabled) {
          const eightDToggle = document.getElementById('dsm-8d-toggle');
          eightDToggle.classList.add('on');
          eightDToggle.textContent = 'Disable';
        }
      }
      if (settings.bands && Array.isArray(settings.bands)) {
        settings.bands.forEach((b, i) => {
          if (i < 30) {
            AudioPipelineLayer.setBand(i, b.gain);
            const slider = document.getElementById(`dsm-eq-${i}`);
            const val = document.getElementById(`dsm-eq-v${i}`);
            if (slider) slider.value = b.gain;
            if (val) val.textContent = (b.gain > 0 ? '+' : '') + b.gain.toFixed(1);
          }
        });
      }
    } catch (err) {
      console.error('Error applying settings:', err);
      alert('Ayarlar yüklenirken hata oluştu: ' + err.message);
    }
  }

  #buildEQ() {
    const labels = ['20','31','40','50','63','80','100','125','160','200','250','315','400','500','630','800','1k','1.25k','1.6k','2k','2.5k','3.15k','4k','5k','6.3k','8k','10k','12.5k','16k','20k'];
    const grid   = document.getElementById('dsm-eq');
    labels.forEach((lbl, i) => {
      const col = document.createElement('div');
      col.className = 'eq-col';
      col.innerHTML = `
        <div class="eq-val" id="dsm-eq-v${i}">0</div>
        <input type="range" id="dsm-eq-${i}" min="-24" max="24" step="0.1" value="0">
        <span>${lbl}</span>
      `;
      grid.appendChild(col);
      const sl  = col.querySelector('input');
      const val = col.querySelector('.eq-val');
      sl.addEventListener('input', () => {
        const v = parseFloat(sl.value);
        val.textContent = (v > 0 ? '+' : '') + v.toFixed(1);
        AudioPipelineLayer.setBand(i, v);
      });
    });

    const presetSelect = document.getElementById('dsm-eq-preset');
    presetSelect.addEventListener('change', () => {
      const preset = presetSelect.value;
      AudioPipelineLayer.applyEQPreset(preset);

      const presets = {
        'flat': new Array(30).fill(0),
        'bass-boost': [4, 4, 4, 4, 3, 3, 2, 2, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        'vocal': [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0],
        'music': [3, 3, 2, 2, 2, 2, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 2, 3, 3, 4, 4, 4],
        'treble': [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 4, 5, 5, 6, 6, 6],
        'loud': [5, 5, 4, 4, 4, 4, 3, 3, 3, 2, 2, 2, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 2, 2, 3, 3, 4, 4, 4],
      };

      const gains = presets[preset] || presets['flat'];
      for (let i = 0; i < 30; i++) {
        const sl = document.getElementById(`dsm-eq-${i}`);
        const val = document.getElementById(`dsm-eq-v${i}`);
        if (sl && val) {
          sl.value = gains[i];
          val.textContent = (gains[i] > 0 ? '+' : '') + gains[i].toFixed(1);
        }
      }
    });
  }
};

if (document.body) UI.build();
else document.addEventListener('DOMContentLoaded', () => UI.build());

})();
}
export function showLRVPanel() { const p = document.getElementById('dsm-panel'); if (p) p.style.display = ''; }
export function hideLRVPanel() { const p = document.getElementById('dsm-panel'); if (p) p.style.display = 'none'; }
