import { useCallback, useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";
import type { WrtcMessage } from "../lib/types";

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

// ── DJ (broadcaster) ──────────────────────────────────────────────────────────
// One outgoing peer connection per player who asks for audio.

export function useDJWebRTC(
  roomId: string | undefined,
  myId: string | undefined,
  stream: MediaStream | null
) {
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    if (!roomId || !myId || !stream) return;

    const channel = supabase.channel(`wrtc:${roomId}`, { config: { broadcast: { self: false } } });

    channel.on("broadcast", { event: "wrtc" }, async ({ payload }: { payload: WrtcMessage }) => {
      if (payload.type === "want-audio") {
        // Create a peer connection for this player
        const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
        peersRef.current.set(payload.from, pc);

        // Send all audio tracks to this peer
        for (const track of stream.getAudioTracks()) {
          pc.addTrack(track, stream);
        }

        pc.onicecandidate = ({ candidate }) => {
          if (candidate) {
            channel.send({
              type: "broadcast", event: "wrtc",
              payload: { type: "ice", from: myId, to: payload.from, candidate: candidate.toJSON() } as WrtcMessage,
            });
          }
        };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        channel.send({
          type: "broadcast", event: "wrtc",
          payload: { type: "offer", from: myId, to: payload.from, sdp: offer } as WrtcMessage,
        });
      }

      if (payload.type === "answer" && payload.to === myId) {
        const pc = peersRef.current.get(payload.from);
        if (pc) await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      }

      if (payload.type === "ice" && payload.to === myId) {
        const pc = peersRef.current.get(payload.from);
        if (pc) await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
      }
    });

    channel.subscribe(() => {
      // Announce we're ready to share audio
      channel.send({
        type: "broadcast", event: "wrtc",
        payload: { type: "audio-ready" } as WrtcMessage,
      });
    });

    channelRef.current = channel;

    return () => {
      channel.send({
        type: "broadcast", event: "wrtc",
        payload: { type: "audio-gone" } as WrtcMessage,
      });
      for (const pc of peersRef.current.values()) pc.close();
      peersRef.current.clear();
      channel.unsubscribe();
    };
  }, [roomId, myId, stream]);
}

// ── Listener (receiver) ───────────────────────────────────────────────────────

export function useListenerWebRTC(
  roomId: string | undefined,
  myId: string | undefined,
  onStream: (stream: MediaStream) => void
) {
  const pcRef      = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const pendingRef = useRef<RTCIceCandidateInit[]>([]);

  const requestAudio = useCallback(() => {
    if (!channelRef.current || !myId) return;
    channelRef.current.send({
      type: "broadcast", event: "wrtc",
      payload: { type: "want-audio", from: myId } as WrtcMessage,
    });
  }, [myId]);

  useEffect(() => {
    if (!roomId || !myId) return;

    const channel = supabase.channel(`wrtc:${roomId}`, { config: { broadcast: { self: false } } });

    channel.on("broadcast", { event: "wrtc" }, async ({ payload }: { payload: WrtcMessage }) => {
      if (payload.type === "audio-ready") {
        // DJ just came online — request audio
        requestAudio();
      }

      if (payload.type === "offer" && payload.to === myId) {
        const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
        pcRef.current = pc;

        pc.ontrack = ({ streams }) => {
          if (streams[0]) onStream(streams[0]);
        };

        pc.onicecandidate = ({ candidate }) => {
          if (candidate) {
            channel.send({
              type: "broadcast", event: "wrtc",
              payload: { type: "ice", from: myId, to: payload.from, candidate: candidate.toJSON() } as WrtcMessage,
            });
          }
        };

        await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));

        // Add any queued ICE candidates
        for (const c of pendingRef.current) await pc.addIceCandidate(new RTCIceCandidate(c));
        pendingRef.current = [];

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        channel.send({
          type: "broadcast", event: "wrtc",
          payload: { type: "answer", from: myId, to: payload.from, sdp: answer } as WrtcMessage,
        });
      }

      if (payload.type === "ice" && payload.to === myId) {
        if (pcRef.current?.remoteDescription) {
          await pcRef.current.addIceCandidate(new RTCIceCandidate(payload.candidate));
        } else {
          pendingRef.current.push(payload.candidate);
        }
      }

      if (payload.type === "audio-gone") {
        pcRef.current?.close();
        pcRef.current = null;
      }
    });

    channel.subscribe(() => requestAudio());
    channelRef.current = channel;

    return () => {
      pcRef.current?.close();
      channel.unsubscribe();
    };
  }, [roomId, myId, onStream, requestAudio]);

  return { requestAudio };
}
