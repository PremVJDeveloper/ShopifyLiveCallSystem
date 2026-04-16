/**
 * WebRTC management library for handling RTCPeerConnection lifecycle.
 */

export class WebRTCManager {
  constructor(config = {}) {
    this.pc = null;
    this.config = {
      iceServers: config.iceServers || [{ urls: 'stun:stun.l.google.com:19302' }],
      iceTransportPolicy: 'all',
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
      ...config
    };
    
    this.localStream = null;
    this.remoteStream = new MediaStream();
    this.iceCandidatesBuffer = [];
    this.onTrackCallback = null;
    this.onIceCandidateCallback = null;
    this.onConnectionStateChangeCallback = null;
  }

  init() {
    if (this.pc) {
      console.warn('Closing existing PeerConnection');
      this.close();
    }

    this.pc = new RTCPeerConnection(this.config);
    this._setupListeners();
    return this.pc;
  }

  _setupListeners() {
    this.pc.ontrack = (event) => {
      console.log('Got remote track:', event.track.kind);
      event.streams[0].getTracks().forEach(track => {
        this.remoteStream.addTrack(track);
      });
      if (this.onTrackCallback) this.onTrackCallback(this.remoteStream);
    };

    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        if (this.onIceCandidateCallback) {
          this.onIceCandidateCallback(event.candidate);
        }
      }
    };

    this.pc.onconnectionstatechange = () => {
      console.log('PeerConnection state:', this.pc.connectionState);
      if (this.onConnectionStateChangeCallback) {
        this.onConnectionStateChangeCallback(this.pc.connectionState);
      }
    };

    this.pc.oniceconnectionstatechange = () => {
      console.log('ICE connection state:', this.pc.iceConnectionState);
      if (this.pc.iceConnectionState === 'failed') {
        this.pc.restartIce();
      }
    };
  }

  addStream(stream) {
    this.localStream = stream;
    stream.getTracks().forEach(track => {
      this.pc.addTrack(track, stream);
    });
    // Apply bandwidth caps after tracks are added
    // Small delay so senders are registered before we modify them
    setTimeout(() => this.applyBandwidthConstraints(), 100);
  }

  /**
   * Cap video to 500 Kbps and audio to 40 Kbps.
   * This prevents WebRTC from saturating slow mobile/guest networks.
   * Effective for connections as low as ~256 Kbps.
   */
  async applyBandwidthConstraints() {
    if (!this.pc) return;
    const senders = this.pc.getSenders();
    for (const sender of senders) {
      if (!sender.track) continue;
      try {
        const params = sender.getParameters();
        if (!params.encodings || params.encodings.length === 0) {
          params.encodings = [{}];
        }
        if (sender.track.kind === 'video') {
          params.encodings[0].maxBitrate   = 500_000;  // 500 Kbps — good 480p on slow networks
          params.encodings[0].maxFramerate = 20;
        } else if (sender.track.kind === 'audio') {
          params.encodings[0].maxBitrate = 40_000;     // 40 Kbps — clear voice quality
        }
        await sender.setParameters(params);
      } catch (e) {
        // setParameters not supported on this browser/version — non-fatal
        console.warn('setParameters not supported:', e.message);
      }
    }
  }

  async createOffer(options = {}) {
    const offer = await this.pc.createOffer(options);
    await this.pc.setLocalDescription(offer);
    return offer;
  }

  async handleOffer(offer) {
    await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    
    // Drain buffered candidates
    while (this.iceCandidatesBuffer.length > 0) {
      const candidate = this.iceCandidatesBuffer.shift();
      await this.addIceCandidate(candidate);
    }
    
    return answer;
  }

  async handleAnswer(answer) {
    await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
    
    // Drain buffered candidates
    while (this.iceCandidatesBuffer.length > 0) {
      const candidate = this.iceCandidatesBuffer.shift();
      await this.addIceCandidate(candidate);
    }
  }

  async addIceCandidate(candidate) {
    if (!this.pc.remoteDescription) {
      console.log('Buffering ICE candidate (remote description not set)');
      this.iceCandidatesBuffer.push(candidate);
      return;
    }
    
    try {
      await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (e) {
      console.error('Error adding ICE candidate:', e);
    }
  }

  replaceTrack(oldTrackKind, newTrack) {
    const sender = this.pc.getSenders().find(s => s.track && s.track.kind === oldTrackKind);
    if (sender) {
      return sender.replaceTrack(newTrack);
    }
    return Promise.reject('No sender found for track kind: ' + oldTrackKind);
  }

  close() {
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    this.iceCandidatesBuffer = [];
  }
}
