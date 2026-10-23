import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  onAuthStateChanged, updateProfile, signOut
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, collection, doc, addDoc, setDoc, getDoc, getDocs, query,
  where, orderBy, onSnapshot, serverTimestamp, updateDoc, arrayUnion
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
  getStorage, ref, uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
const $ = (id) => document.getElementById(id);

let currentUser = null;
let authMode = "login";
let activeChatId = null;
let activePeer = null;
let stopChats = null;
let stopMessages = null;
let stopCallDoc = null;
let stopIncomingCalls = null;
let handledIncomingCall = null;
let callPc = null;
let localStream = null;
let currentCallId = null;
let isCaller = false;
let callKind = "audio";
let callUnsubCandidates = [];
let toastTimer;

function toast(message) {
  $("toast").textContent = message;
  $("toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("toast").classList.remove("show"), 3000);
}
function initials(name = "U") { return name.trim().slice(0, 1).toUpperCase() || "U"; }
function safeDate(ts) {
  try { return ts?.toDate ? ts.toDate() : new Date(); } catch { return new Date(); }
}
function timeLabel(ts) {
  return safeDate(ts).toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"});
}
function setAuthMode(mode) {
  authMode = mode;
  const signup = mode === "signup";
  $("nameLabel").classList.toggle("hidden", !signup);
  $("loginTab").classList.toggle("active", !signup);
  $("signupTab").classList.toggle("active", signup);
  $("authSubmit").textContent = signup ? "Create account" : "Log in";
  $("password").autocomplete = signup ? "new-password" : "current-password";
  $("authError").textContent = "";
}
$("loginTab").onclick = () => setAuthMode("login");
$("signupTab").onclick = () => setAuthMode("signup");

$("authForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("authError").textContent = "";
  const email = $("email").value.trim().toLowerCase();
  const password = $("password").value;
  try {
    if (authMode === "signup") {
      const name = $("displayName").value.trim();
      if (!name) throw new Error("Please enter a display name.");
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(credential.user, {displayName: name});
      await setDoc(doc(db, "users", credential.user.uid), {
        uid: credential.user.uid, name, email, createdAt: serverTimestamp()
      });
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
  } catch (error) {
    $("authError").textContent = friendlyAuthError(error);
  }
});
function friendlyAuthError(error) {
  const map = {
    "auth/email-already-in-use":"That email already has an account.",
    "auth/invalid-email":"Please enter a valid email address.",
    "auth/weak-password":"Choose a password with at least 6 characters.",
    "auth/invalid-credential":"Email or password is incorrect.",
    "auth/user-not-found":"No account found for that email.",
    "auth/network-request-failed":"Network problem. Check your connection."
  };
  return map[error.code] || error.message || "Something went wrong.";
}
$("logoutBtn").onclick = async () => { await endCall(false); await signOut(auth); };

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if (user) {
    try {
      const profileRef = doc(db, "users", user.uid);
      const profile = await getDoc(profileRef);
      if (!profile.exists()) await setDoc(profileRef, {
        uid: user.uid, name: user.displayName || user.email.split("@")[0],
        email: user.email.toLowerCase(), createdAt: serverTimestamp()
      });
      $("authScreen").classList.add("hidden");
      $("chatApp").classList.remove("hidden");
      $("myName").textContent = user.displayName || user.email.split("@")[0];
      $("myEmail").textContent = user.email;
      $("myAvatar").textContent = initials(user.displayName || user.email);
      subscribeChats();
      subscribeIncomingCalls();
    } catch (error) {
      toast("Could not load profile: " + error.message);
    }
  } else {
    if (stopChats) stopChats();
    if (stopIncomingCalls) stopIncomingCalls();
    if (stopMessages) stopMessages();
    $("chatApp").classList.add("hidden");
    $("authScreen").classList.remove("hidden");
    $("chatList").innerHTML = "";
    showEmpty();
  }
});

$("newChatBtn").onclick = openNewChat;
$("emptyNewChatBtn").onclick = openNewChat;
$("closeNewChat").onclick = () => $("newChatDialog").close();
function openNewChat() {
  $("contactEmail").value = "";
  $("newChatError").textContent = "";
  $("newChatDialog").showModal();
}
$("newChatForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentUser) return;
  $("newChatError").textContent = "";
  const email = $("contactEmail").value.trim().toLowerCase();
  if (email === currentUser.email.toLowerCase()) {
    $("newChatError").textContent = "You cannot start a chat with yourself.";
    return;
  }
  try {
    const found = await getDocs(query(collection(db, "users"), where("email", "==", email)));
    if (found.empty) {
      $("newChatError").textContent = "No account found. Ask them to sign up first.";
      return;
    }
    const peer = found.docs[0].data();
    const memberIds = [currentUser.uid, peer.uid].sort();
    const chatId = memberIds.join("_");
    const chatRef = doc(db, "chats", chatId);
    const existing = await getDoc(chatRef);
    if (!existing.exists()) {
      await setDoc(chatRef, {
        members: memberIds,
        memberProfiles: {
          [currentUser.uid]: {name: currentUser.displayName || currentUser.email.split("@")[0], email: currentUser.email},
          [peer.uid]: {name: peer.name || peer.email.split("@")[0], email: peer.email}
        },
        createdAt: serverTimestamp(), lastMessage: "", updatedAt: serverTimestamp()
      });
    }
    $("newChatDialog").close();
    await selectChat(chatId, peer);
  } catch (error) {
    $("newChatError").textContent = error.message || "Could not create chat.";
  }
});

function subscribeChats() {
  if (stopChats) stopChats();
  const chatsQuery = query(collection(db, "chats"), where("members", "array-contains", currentUser.uid));
  stopChats = onSnapshot(chatsQuery, (snapshot) => {
    const chats = snapshot.docs.map(d => ({id:d.id, ...d.data()}));
    chats.sort((a,b) => (b.updatedAt?.toMillis?.() || 0) - (a.updatedAt?.toMillis?.() || 0));
    renderChatList(chats);
  }, (error) => toast("Chats error: " + error.message));
}
let cachedChats = [];
function renderChatList(chats) {
  cachedChats = chats;
  const filter = $("searchChats").value.trim().toLowerCase();
  const visible = chats.filter(chat => {
    const peerId = chat.members.find(id => id !== currentUser.uid);
    const peer = chat.memberProfiles?.[peerId] || {};
    return (peer.name || peer.email || "").toLowerCase().includes(filter);
  });
  $("chatList").innerHTML = "";
  if (!visible.length) {
    const p = document.createElement("p");
    p.className = "muted";
    p.style.cssText = "padding:12px 18px;font-size:13px";
    p.textContent = filter ? "No matching chats." : "No chats yet. Press ＋ to start one.";
    $("chatList").append(p); return;
  }
  for (const chat of visible) {
    const peerId = chat.members.find(id => id !== currentUser.uid);
    const peer = chat.memberProfiles?.[peerId] || {name:"Contact",email:""};
    const item = document.createElement("div");
    item.className = "chat-item" + (chat.id === activeChatId ? " selected" : "");
    const avatar = document.createElement("div");
    avatar.className = "avatar"; avatar.textContent = initials(peer.name || peer.email);
    const summary = document.createElement("div"); summary.className = "chat-summary";
    const titleLine = document.createElement("div"); titleLine.className = "chat-title-line";
    const title = document.createElement("strong"); title.textContent = peer.name || peer.email || "Contact";
    const time = document.createElement("time"); time.textContent = chat.updatedAt ? timeLabel(chat.updatedAt) : "";
    titleLine.append(title,time);
    const preview = document.createElement("div"); preview.className = "chat-preview";
    preview.textContent = chat.lastMessage || peer.email || "Start a conversation";
    summary.append(titleLine,preview); item.append(avatar,summary);
    item.onclick = () => selectChat(chat.id, {...peer, uid:peerId});
    $("chatList").append(item);
  }
}
$("searchChats").addEventListener("input", () => renderChatList(cachedChats));

function showEmpty() {
  activeChatId = null; activePeer = null;
  if (stopMessages) stopMessages();
  $("conversationPanel").classList.add("hidden");
  $("emptyState").classList.remove("hidden");
}
async function selectChat(chatId, peer) {
  activeChatId = chatId;
  activePeer = peer;
  $("emptyState").classList.add("hidden");
  $("conversationPanel").classList.remove("hidden");
  $("peerName").textContent = peer.name || peer.email || "Contact";
  $("peerAvatar").textContent = initials(peer.name || peer.email);
  $("peerStatus").textContent = peer.email || "Conversation";
  renderChatList(cachedChats);
  if (stopMessages) stopMessages();
  $("messages").innerHTML = "";
  const messagesQuery = query(collection(db, "chats", chatId, "messages"), orderBy("createdAt", "asc"));
  stopMessages = onSnapshot(messagesQuery, (snapshot) => {
    $("messages").innerHTML = "";
    for (const messageDoc of snapshot.docs) renderMessage(messageDoc.data());
    $("messages").scrollTop = $("messages").scrollHeight;
  }, (error) => toast("Messages error: " + error.message));
}
function renderMessage(message) {
  const bubble = document.createElement("div");
  bubble.className = "message" + (message.senderId === currentUser.uid ? " mine" : "");
  if (message.type === "image" && message.fileUrl) {
    const img = document.createElement("img"); img.src = message.fileUrl; img.alt = message.fileName || "Shared image"; img.loading = "lazy";
    bubble.append(img);
    if (message.text) { const caption = document.createElement("div"); caption.textContent = message.text; bubble.append(caption); }
  } else if (message.type === "file" && message.fileUrl) {
    const link = document.createElement("a"); link.href = message.fileUrl; link.target = "_blank"; link.rel = "noopener noreferrer";
    link.className = "file-link"; link.textContent = "📎 " + (message.fileName || "Download file"); bubble.append(link);
    if (message.text) { const caption = document.createElement("div"); caption.textContent = message.text; bubble.append(caption); }
  } else {
    const text = document.createElement("div"); text.textContent = message.text || ""; bubble.append(text);
  }
  const meta = document.createElement("div"); meta.className = "meta";
  const time = document.createElement("span"); time.textContent = timeLabel(message.createdAt);
  meta.append(time);
  if (message.senderId === currentUser.uid) { const tick = document.createElement("span"); tick.textContent = "✓"; meta.append(tick); }
  bubble.append(meta); $("messages").append(bubble);
}
$("messageForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = $("messageInput").value.trim();
  if (!text || !activeChatId) return;
  $("messageInput").value = "";
  try { await sendMessage({text,type:"text"}); }
  catch (error) { $("messageInput").value = text; toast("Message failed: " + error.message); }
});
async function sendMessage(data) {
  const chatRef = doc(db, "chats", activeChatId);
  await addDoc(collection(chatRef, "messages"), {
    ...data, senderId: currentUser.uid, createdAt: serverTimestamp()
  });
  await updateDoc(chatRef, {lastMessage: data.text || (data.type === "image" ? "📷 Image" : "📎 File"), updatedAt: serverTimestamp()});
}
$("fileInput").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file || !activeChatId) return;
  if (file.size > 5 * 1024 * 1024) { toast("Please choose a file smaller than 5 MB."); return; }
  const allowed = file.type.startsWith("image/") || /\.(pdf|txt|doc|docx)$/i.test(file.name);
  if (!allowed) { toast("Choose an image, PDF, text, or Word document."); return; }
  $("uploadStatus").textContent = "Uploading " + file.name + "…";
  try {
    const path = `chatUploads/${activeChatId}/${currentUser.uid}/${Date.now()}_${file.name.replace(/[^\w.-]/g,"_")}`;
    const fileRef = ref(storage, path);
    await uploadBytes(fileRef, file);
    const url = await getDownloadURL(fileRef);
    await sendMessage({text:"",type:file.type.startsWith("image/") ? "image" : "file",fileUrl:url,fileName:file.name});
    $("uploadStatus").textContent = "Upload complete";
    setTimeout(() => $("uploadStatus").textContent = "", 1800);
  } catch (error) {
    $("uploadStatus").textContent = "";
    toast("Upload failed: " + error.message);
  }
});

// Listen for incoming call invitations while signed in.
function subscribeIncomingCalls() {
  if (stopIncomingCalls) stopIncomingCalls();
  const incomingQuery = query(
    collection(db, "calls"),
    where("calleeId", "==", currentUser.uid),
    where("status", "==", "ringing")
  );
  stopIncomingCalls = onSnapshot(incomingQuery, (snapshot) => {
    for (const change of snapshot.docChanges()) {
      if (change.type === "added" && change.doc.id !== handledIncomingCall) {
        const callData = change.doc.data();
        if (callData.callerId === currentUser.uid) continue;
        handledIncomingCall = change.doc.id;
        const accept = window.confirm(
          `${callData.kind === "video" ? "Video" : "Audio"} call incoming. Accept?`
        );
        if (accept) acceptIncomingCall(change.doc.id, callData).catch(error => {
          toast("Could not answer call: " + error.message);
          endCall(false);
        });
        else updateDoc(doc(db, "calls", change.doc.id), {
          status: "ended", endedAt: serverTimestamp()
        }).catch(() => {});
      }
    }
  }, (error) => console.error("Incoming call listener:", error));
}

async function acceptIncomingCall(callId, data) {
  if (currentCallId) { toast("You are already in a call."); return; }
  currentCallId = callId;
  isCaller = false;
  callKind = data.kind || "audio";
  const chat = cachedChats.find(item => item.id === data.chatId);
  const callerId = data.callerId;
  const peerProfile = chat?.memberProfiles?.[callerId] || {name:"Contact",email:""};
  $("callAvatar").textContent = initials(peerProfile.name || peerProfile.email);
  $("callTitle").textContent = `Incoming ${callKind} call`;
  $("callStatus").textContent = "Connecting…";
  $("remoteVideoWrap").classList.toggle("hidden", callKind !== "video");
  $("callDialog").showModal();

  localStream = await navigator.mediaDevices.getUserMedia({
    audio:true, video:callKind === "video"
  });
  $("localVideo").srcObject = localStream;
  callPc = new RTCPeerConnection({iceServers:[{urls:"stun:stun.l.google.com:19302"}]});
  localStream.getTracks().forEach(track => callPc.addTrack(track, localStream));
  callPc.ontrack = (event) => {
    if (callKind === "video") $("remoteVideo").srcObject = event.streams[0];
    else $("remoteAudio").srcObject = event.streams[0];
  };
  callPc.oniceconnectionstatechange = () => {
    if (callPc?.iceConnectionState === "connected" || callPc?.iceConnectionState === "completed") $("callStatus").textContent = "Connected";
    if (callPc?.iceConnectionState === "failed") $("callStatus").textContent = "Connection failed. Try another network.";
  };

  const callRef = doc(db, "calls", callId);
  const callerCandidates = collection(callRef, "callerCandidates");
  const calleeCandidates = collection(callRef, "calleeCandidates");
  callPc.onicecandidate = (event) => {
    if (event.candidate) addDoc(calleeCandidates, event.candidate.toJSON()).catch(console.error);
  };
  await callPc.setRemoteDescription(new RTCSessionDescription(data.offer));
  const answer = await callPc.createAnswer();
  await callPc.setLocalDescription(answer);
  await updateDoc(callRef, {
    answer:{type:answer.type,sdp:answer.sdp}, status:"answered",
    answeredAt:serverTimestamp()
  });
  stopCallDoc = onSnapshot(callRef, async (snapshot) => {
    const latest = snapshot.data();
    if (latest?.status === "ended") { await endCall(false); toast("Call ended."); }
  });
  callUnsubCandidates.push(onSnapshot(callerCandidates, snap => snap.docChanges().forEach(change => {
    if (change.type === "added") callPc?.addIceCandidate(new RTCIceCandidate(change.doc.data())).catch(console.error);
  })));
}

// Basic 1-to-1 WebRTC calls. Firestore is used for call offers, answers and ICE candidates.
$("audioCallBtn").onclick = () => startCall("audio");
$("videoCallBtn").onclick = () => startCall("video");
$("hangupBtn").onclick = () => endCall(true);
$("muteCallBtn").onclick = () => {
  if (!localStream) return;
  const track = localStream.getAudioTracks()[0];
  if (track) { track.enabled = !track.enabled; $("muteCallBtn").style.opacity = track.enabled ? "1" : ".45"; }
};
$("cameraCallBtn").onclick = () => {
  if (!localStream) return;
  const track = localStream.getVideoTracks()[0];
  if (track) { track.enabled = !track.enabled; $("cameraCallBtn").style.opacity = track.enabled ? "1" : ".45"; }
};
async function startCall(kind) {
  if (!activeChatId || !activePeer) { toast("Open a conversation first."); return; }
  if (currentCallId) { toast("A call is already active."); return; }
  callKind = kind;
  isCaller = true;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({audio:true, video:kind === "video"});
    $("localVideo").srcObject = localStream;
    $("remoteVideoWrap").classList.toggle("hidden", kind !== "video");
    $("remoteAudio").srcObject = null;
    $("callAvatar").textContent = initials(activePeer.name || activePeer.email);
    $("callTitle").textContent = `${kind === "video" ? "Video" : "Audio"} calling ${activePeer.name || activePeer.email}`;
    $("callStatus").textContent = "Waiting for the other person…";
    $("callDialog").showModal();
    callPc = new RTCPeerConnection({iceServers:[{urls:"stun:stun.l.google.com:19302"}]});
    localStream.getTracks().forEach(track => callPc.addTrack(track, localStream));
    callPc.ontrack = (event) => {
      const stream = event.streams[0];
      if (callKind === "video") $("remoteVideo").srcObject = stream;
      else $("remoteAudio").srcObject = stream;
    };
    callPc.oniceconnectionstatechange = () => {
      if (callPc?.iceConnectionState === "connected" || callPc?.iceConnectionState === "completed") $("callStatus").textContent = "Connected";
      if (callPc?.iceConnectionState === "failed") $("callStatus").textContent = "Connection failed. Try another network.";
    };
    const callRef = doc(collection(db, "calls"));
    currentCallId = callRef.id;
    const callerCandidates = collection(callRef, "callerCandidates");
    const calleeCandidates = collection(callRef, "calleeCandidates");
    callPc.onicecandidate = (event) => { if (event.candidate) addDoc(callerCandidates, event.candidate.toJSON()).catch(console.error); };
    const offer = await callPc.createOffer();
    await callPc.setLocalDescription(offer);
    await setDoc(callRef, {
      chatId:activeChatId, callerId:currentUser.uid, calleeId:activePeer.uid,
      kind, offer:{type:offer.type,sdp:offer.sdp}, status:"ringing", createdAt:serverTimestamp()
    });
    stopCallDoc = onSnapshot(callRef, async (snapshot) => {
      const data = snapshot.data();
      if (!data) return;
      if (data.answer && !callPc.currentRemoteDescription) {
        await callPc.setRemoteDescription(new RTCSessionDescription(data.answer));
        $("callStatus").textContent = "Answer received. Connecting…";
      }
      if (data.status === "ended") { await endCall(false); toast("Call ended."); }
    });
    callUnsubCandidates.push(onSnapshot(calleeCandidates, snap => snap.docChanges().forEach(change => {
      if (change.type === "added") callPc?.addIceCandidate(new RTCIceCandidate(change.doc.data())).catch(console.error);
    })));
    toast("Call started. The other person must accept it from their device.");
  } catch (error) {
    await endCall(false);
    toast("Could not start call: " + (error.message || "Check browser permissions."));
  }
}
async function endCall(notifyPeer = true) {
  const callId = currentCallId;
  if (notifyPeer && callId && isCaller) {
    try { await updateDoc(doc(db,"calls",callId), {status:"ended", endedAt:serverTimestamp()}); } catch {}
  }
  if (stopCallDoc) { stopCallDoc(); stopCallDoc = null; }
  callUnsubCandidates.forEach(unsub => unsub()); callUnsubCandidates = [];
  if (callPc) { callPc.ontrack = null; callPc.onicecandidate = null; callPc.close(); callPc = null; }
  if (localStream) { localStream.getTracks().forEach(track => track.stop()); localStream = null; }
  $("localVideo").srcObject = null; $("remoteVideo").srcObject = null; $("remoteAudio").srcObject = null;
  if ($("callDialog").open) $("callDialog").close();
  currentCallId = null; isCaller = false;
}
