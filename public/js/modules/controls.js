/**
 * Controls module — camera, microphone, screen share toggle buttons.
 */
import { dom } from '../utils/dom.js';
import {
  toggleTrack, startScreenShare, stopAllTracks, replaceVideoTrack
} from './media.js';

let state = {
  videoEnabled: true,
  audioEnabled: true,
  screenSharing: false,
  screenStream: null,
};

let localStream = null;
let peerConnection = null;
let localVideoEl = null;
let originalStream = null;

/**
 * Initialize the controls module with references.
 */
export function init({ stream, pc, localVideo, onStateChange }) {
  localStream = stream;
  peerConnection = pc;
  localVideoEl = localVideo;
  originalStream = stream;
  state.videoEnabled = stream.getVideoTracks().length > 0;
  state.audioEnabled = stream.getAudioTracks().length > 0;
  if (onStateChange) _notify = onStateChange;
}

let _notify = () => {};

export function updateStream(stream) {
  localStream = stream;
  originalStream = stream;
}

export function updatePC(pc) {
  peerConnection = pc;
}

/**
 * Toggle camera on/off.
 */
export function toggleVideo(btnEl) {
  if (!localStream || localStream.getVideoTracks().length === 0) return state.videoEnabled;
  state.videoEnabled = toggleTrack(localStream, 'video');
  
  if (btnEl) {
    dom.toggleClass(btnEl, 'inactive', !state.videoEnabled);
    btnEl.querySelector('.btn-label').textContent = state.videoEnabled ? 'Camera' : 'Camera Off';
    btnEl.querySelector('.btn-icon').textContent = state.videoEnabled ? '📷' : '🚫';
  }
  _notify({ ...state });
  return state.videoEnabled;
}

/**
 * Toggle microphone on/off.
 */
export function toggleAudio(btnEl) {
  if (!localStream) return state.audioEnabled;
  state.audioEnabled = toggleTrack(localStream, 'audio');
  
  if (btnEl) {
    dom.toggleClass(btnEl, 'inactive', !state.audioEnabled);
    btnEl.querySelector('.btn-label').textContent = state.audioEnabled ? 'Mic' : 'Muted';
    btnEl.querySelector('.btn-icon').textContent = state.audioEnabled ? '🎙' : '🔇';
  }
  _notify({ ...state });
  return state.audioEnabled;
}

/**
 * Start/stop screen share, replacing the video track in the PeerConnection.
 */
export async function toggleScreenShare(btnEl) {
  if (state.screenSharing) {
    // Stop screen share
    stopAllTracks(state.screenStream);
    state.screenStream = null;
    state.screenSharing = false;

    // Restore original video track
    if (peerConnection && originalStream) {
      const origTrack = originalStream.getVideoTracks()[0];
      if (origTrack) await replaceVideoTrack(peerConnection, origTrack);
    }
    if (localVideoEl) localVideoEl.srcObject = originalStream;

    if (btnEl) {
      dom.removeClass(btnEl, 'active');
      btnEl.querySelector('.btn-label').textContent = 'Present';
      btnEl.querySelector('.btn-icon').textContent = '🖥';
    }
  } else {
    try {
      const screenStream = await startScreenShare();
      const videoTrack = screenStream.getVideoTracks()[0];

      // Replace in PeerConnection
      if (peerConnection) await replaceVideoTrack(peerConnection, videoTrack);

      // Preview locally
      if (localVideoEl) localVideoEl.srcObject = screenStream;

      state.screenStream = screenStream;
      state.screenSharing = true;

      // When user stops via browser UI
      videoTrack.onended = () => toggleScreenShare(btnEl);

      if (btnEl) {
        dom.addClass(btnEl, 'active');
        btnEl.querySelector('.btn-label').textContent = 'Stop';
        btnEl.querySelector('.btn-icon').textContent = '🛑';
      }
    } catch (e) {
      console.error('Screen share error:', e);
    }
  }
  _notify({ ...state });
  return state.screenSharing;
}

/**
 * Clean up all streams on call end.
 */
export function cleanup() {
  if (state.screenStream) stopAllTracks(state.screenStream);
  if (localStream) stopAllTracks(localStream);
  state = { videoEnabled: false, audioEnabled: false, screenSharing: false, screenStream: null };
}

export function getState() { return { ...state }; }
