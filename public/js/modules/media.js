/**
 * Media module — handles getUserMedia, screen share, track replacement.
 * Constraints tuned for low-latency on variable Indian networks.
 */

// Balanced quality — 480p works well on 1–5 Mbps connections
const CONSTRAINTS_HIGH = {
  video: {
    width:     { ideal: 854,  max: 1280 },
    height:    { ideal: 480,  max: 720  },
    frameRate: { ideal: 20,   max: 30   },
    facingMode: 'user',
  },
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl:  true,
    sampleRate: 16000,      // lower sample rate = less bandwidth for audio
  },
};

// Fallback — 360p/15fps, works on 512 Kbps+
const CONSTRAINTS_LOW = {
  video: {
    width:     { ideal: 640, max: 854 },
    height:    { ideal: 360, max: 480 },
    frameRate: { ideal: 15, max: 20  },
  },
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
};

const CONSTRAINTS_AUDIO_ONLY = {
  video: false,
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
};

/**
 * Attempt to acquire media. Falls back from high → low → audio-only.
 * Returns { stream, hasVideo, hasAudio } or throws.
 */
export async function requestMedia() {
  // Try high quality
  try {
    const stream = await navigator.mediaDevices.getUserMedia(CONSTRAINTS_HIGH);
    return { stream, hasVideo: stream.getVideoTracks().length > 0, hasAudio: stream.getAudioTracks().length > 0 };
  } catch (e) {
    console.warn('High-quality media failed, trying low:', e.name);
  }

  // Try low quality
  try {
    const stream = await navigator.mediaDevices.getUserMedia(CONSTRAINTS_LOW);
    return { stream, hasVideo: stream.getVideoTracks().length > 0, hasAudio: stream.getAudioTracks().length > 0 };
  } catch (e) {
    console.warn('Low-quality media failed, trying audio-only:', e.name);
  }

  // Try audio only
  try {
    const stream = await navigator.mediaDevices.getUserMedia(CONSTRAINTS_AUDIO_ONLY);
    return { stream, hasVideo: false, hasAudio: true };
  } catch (e) {
    console.error('All media acquisition failed:', e.name);
    throw e;
  }
}

/**
 * Start screen sharing. Returns a screen stream.
 */
export async function startScreenShare() {
  return navigator.mediaDevices.getDisplayMedia({
    video: { cursor: 'always', displaySurface: 'monitor' },
    audio: true,
  });
}

/**
 * Stop all tracks on a stream.
 */
export function stopAllTracks(stream) {
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
  }
}

/**
 * Toggle a specific track kind (video/audio) on/off.
 * Returns the new enabled state.
 */
export function toggleTrack(stream, kind) {
  if (!stream) return false;
  const tracks = kind === 'video' ? stream.getVideoTracks() : stream.getAudioTracks();
  const newState = !tracks[0]?.enabled;
  tracks.forEach(t => { t.enabled = newState; });
  return newState;
}

/**
 * Replace one video track in a PeerConnection with another (for screen share).
 */
export async function replaceVideoTrack(pc, newTrack) {
  const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
  if (sender) {
    await sender.replaceTrack(newTrack);
    return true;
  }
  return false;
}
