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
 * The screen renders in a dedicated #screenTile panel (Google Meet-style).
 * localVideo keeps the camera feed visible throughout.
 */
export async function toggleScreenShare(btnEl) {
  const videoGrid  = document.getElementById('videoGrid');
  const screenTile = document.getElementById('screenTile');
  const screenVideo = document.getElementById('screenVideo');

  if (state.screenSharing) {
    // ── Stop screen share ──────────────────────────────────────
    stopAllTracks(state.screenStream);
    state.screenStream = null;
    state.screenSharing = false;

    // Hide screen tile, restore normal grid layout
    if (screenTile)  screenTile.style.display  = 'none';
    if (screenVideo) screenVideo.srcObject = null;
    if (videoGrid)   videoGrid.classList.remove('screen-sharing');

    // Restore original camera track in PeerConnection
    if (peerConnection && originalStream) {
      const origTrack = originalStream.getVideoTracks()[0];
      if (origTrack) await replaceVideoTrack(peerConnection, origTrack);
    }

    if (btnEl) {
      dom.removeClass(btnEl, 'active');
      btnEl.querySelector('.btn-label').textContent = 'Present';
    }
  } else {
    try {
      // ── Start screen share ─────────────────────────────────────
      const screenStream = await startScreenShare();
      const videoTrack   = screenStream.getVideoTracks()[0];

      // Replace the video track sent to the peer
      if (peerConnection) await replaceVideoTrack(peerConnection, videoTrack);

      // Show screen in the dedicated tile (localVideo keeps camera)
      if (screenVideo) screenVideo.srcObject = screenStream;
      if (screenTile)  screenTile.style.display  = 'flex';
      if (videoGrid)   videoGrid.classList.add('screen-sharing');

      state.screenStream  = screenStream;
      state.screenSharing = true;

      // Auto-stop when user clicks browser's "Stop sharing" button
      videoTrack.onended = () => toggleScreenShare(btnEl);

      if (btnEl) {
        dom.addClass(btnEl, 'active');
        btnEl.querySelector('.btn-label').textContent = 'Stop';
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
