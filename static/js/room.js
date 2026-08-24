const socket = io({
    transports: ['polling', 'websocket'],
    upgrade: true,
    reconnection: true,
    reconnectionAttempts: 15,
    timeout: 20000
});

let player = null;
let isPlayerReady = false;
let isSyncing = false;
let currentVideoId = null;
let isPlaying = false;
let maxUsers = 10;
let lastUsers = [];
let roomQueue = [];
window._moods = {};
window._lastSeen = {};

const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const searchResults = document.getElementById('searchResults');
const npTitle = document.getElementById('npTitle');
const playerPlaceholder = document.getElementById('playerPlaceholder');
const btnPlayPause = document.getElementById('btnPlayPause');
const btnBack10 = document.getElementById('btnBack10');
const btnFwd10 = document.getElementById('btnFwd10');
const btnNext = document.getElementById('btnNext');
const seekBar = document.getElementById('seekBar');
const currentTimeEl = document.getElementById('currentTime');
const durationEl = document.getElementById('duration');
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');
const usersList = document.getElementById('usersList');
const userCount = document.getElementById('userCount');
const reactionOverlay = document.getElementById('reactionOverlay');
const sharedNotes = document.getElementById('sharedNotes');
const todoInput = document.getElementById('todoInput');
const todoAddBtn = document.getElementById('todoAddBtn');
const todoList = document.getElementById('todoList');
const photoInput = document.getElementById('photoInput');
const photoBtn = document.getElementById('photoBtn');
const queueList = document.getElementById('queueList');
const queueCount = document.getElementById('queueCount');

const micOnBtn = document.getElementById('micOnBtn');
const micMuteBtn = document.getElementById('micMuteBtn');
const micOffBtn = document.getElementById('micOffBtn');
const voiceLiveStatus = document.getElementById('voiceLiveStatus');
const remoteAudios = document.getElementById('remoteAudios');

let localStream = null;
let voiceMuted = false;
const pcs = {};

const iceConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

function onYouTubeIframeAPIReady() {
    player = new YT.Player('player', {
        height: '100%',
        width: '100%',
        playerVars: { autoplay: 0, controls: 0, modestbranding: 1, rel: 0, fs: 1, playsinline: 1 },
        events: {
            onReady: () => { isPlayerReady = true; },
            onStateChange: onPlayerStateChange
        }
    });
}
const ytTag = document.createElement('script');
ytTag.src = 'https://www.youtube.com/iframe_api';
document.head.appendChild(ytTag);

function onPlayerStateChange(event) {
    if (isSyncing) return;
    if (event.data === YT.PlayerState.PLAYING) {
        isPlaying = true;
        btnPlayPause.textContent = '⏸';
        emitPlayerAction('play');
    } else if (event.data === YT.PlayerState.PAUSED) {
        isPlaying = false;
        btnPlayPause.textContent = '▶️';
        emitPlayerAction('pause');
    } else if (event.data === YT.PlayerState.ENDED) {
        isPlaying = false;
        btnPlayPause.textContent = '▶️';
        if (roomQueue.length) {
            socket.emit('queue_next', { room_id: ROOM_ID });
        }
    }
}

function emitPlayerAction(action, extra = {}) {
    if (!isPlayerReady || isSyncing) return;
    const currentTime = player.getCurrentTime ? player.getCurrentTime() : 0;
    socket.emit('player_action', {
        room_id: ROOM_ID,
        action,
        current_time: currentTime,
        video_id: currentVideoId,
        title: npTitle.textContent,
        ...extra
    });
}

socket.on('connect', () => {
    userCount.textContent = '…';
    socket.emit('join_room', { room_id: ROOM_ID, username: USERNAME, avatar: '👤' });
});
socket.on('connect_error', () => { userCount.textContent = 'Reconnecting...'; });
socket.on('disconnect', () => { userCount.textContent = 'Offline'; });

socket.on('room_full', (data) => {
    alert('Room full (' + data.count + '/' + data.max + '). Try another code.');
    window.location.href = '/';
});
socket.on('error_msg', (data) => alert((data && data.text) || 'Error'));

socket.on('room_state', (data) => {
    maxUsers = data.max_users || 10;
    window._moods = data.moods || {};
    window._lastSeen = data.last_seen || {};
    lastUsers = data.users || [];
    updateUsers(lastUsers, maxUsers);

    if (typeof data.notes === 'string' && sharedNotes && document.activeElement !== sharedNotes) {
        sharedNotes.value = data.notes;
    }
    if (data.todos) renderTodos(data.todos);
    if (data.queue) renderQueue(data.queue);

    if (data.player && data.player.video_id) {
        loadVideo(data.player.video_id, data.player.title, false);
        setTimeout(() => {
            if (player && player.seekTo) {
                isSyncing = true;
                player.seekTo(data.player.current_time || 0, true);
                if (data.player.is_playing) {
                    player.playVideo();
                    btnPlayPause.textContent = '⏸';
                    isPlaying = true;
                } else {
                    player.pauseVideo();
                    btnPlayPause.textContent = '▶️';
                    isPlaying = false;
                }
                setTimeout(() => { isSyncing = false; }, 800);
            }
        }, 1200);
    }
    if (data.messages) {
        chatMessages.innerHTML = '';
        data.messages.forEach((msg) => appendMessage(msg));
    }
});

socket.on('user_joined', (data) => {
    if (data.moods) window._moods = data.moods;
    if (data.last_seen) window._lastSeen = data.last_seen;
    lastUsers = data.users || [];
    updateUsers(lastUsers, data.max_users || maxUsers);
    showSystemMessage(data.user.name + ' joined');
});

socket.on('user_left', (data) => {
    if (data.moods) window._moods = data.moods;
    if (data.last_seen) window._lastSeen = data.last_seen;
    lastUsers = data.users || [];
    updateUsers(lastUsers, data.max_users || maxUsers);
    showSystemMessage(data.name + ' left');
});

/* FIXED: load always applies (including self) so Next works */
socket.on('player_sync', (data) => {
    if (data.action === 'load' && data.video_id) {
        isSyncing = true;
        loadVideo(data.video_id, data.title, false);
        setTimeout(() => {
            if (player) {
                try {
                    player.seekTo(0, true);
                    player.playVideo();
                } catch (e) {}
                btnPlayPause.textContent = '⏸';
                isPlaying = true;
            }
            isSyncing = false;
        }, 1000);
        return;
    }

    if (data.from_sid === socket.id) return;

    isSyncing = true;
    if (!player || !isPlayerReady) {
        isSyncing = false;
        return;
    }
    if (data.action === 'play') {
        player.seekTo(data.current_time || 0, true);
        player.playVideo();
        btnPlayPause.textContent = '⏸';
        isPlaying = true;
    } else if (data.action === 'pause') {
        player.seekTo(data.current_time || 0, true);
        player.pauseVideo();
        btnPlayPause.textContent = '▶️';
        isPlaying = false;
    } else if (data.action === 'seek') {
        player.seekTo(data.current_time || 0, true);
    }
    setTimeout(() => { isSyncing = false; }, 600);
});

socket.on('new_message', appendMessage);
socket.on('reaction', (data) => showFloatingReaction(data.reaction));
socket.on('queue_sync', (data) => renderQueue(data.queue || []));
socket.on('queue_empty', () => showSystemMessage('Queue empty'));

socket.on('notes_sync', (data) => {
    if (data.from_sid === socket.id) return;
    if (sharedNotes && document.activeElement !== sharedNotes) {
        sharedNotes.value = data.text || '';
    }
});
socket.on('todos_sync', (data) => renderTodos(data.todos || []));
socket.on('mood_update', (data) => {
    window._moods = data.moods || {};
    if (data.last_seen) window._lastSeen = data.last_seen;
    updateUsers(lastUsers, maxUsers);
});
socket.on('last_seen_sync', (data) => {
    window._lastSeen = data.last_seen || {};
    if (data.moods) window._moods = data.moods;
    if (data.users) lastUsers = data.users;
    updateUsers(lastUsers, maxUsers);
});

function formatLastSeen(iso) {
    if (!iso) return '';
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 45) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    return Math.floor(diff / 3600) + 'h ago';
}

function updateUsers(users, max = 10) {
    usersList.innerHTML = '';
    const count = users ? users.length : 0;
    userCount.textContent = count + '/' + max;
    if (!users || !count) return;
    const moods = window._moods || {};
    const lastSeen = window._lastSeen || {};
    users.forEach((u) => {
        const mood = moods[u.name] || '';
        const seen = formatLastSeen(lastSeen[u.name]);
        const div = document.createElement('div');
        div.className = 'user-item';
        div.innerHTML =
            '<span class="user-avatar">' + (u.avatar || '👤') + '</span>' +
            '<div><div class="user-name">' + escapeHtml(u.name) +
            (mood ? ' · ' + escapeHtml(mood) : '') + '</div>' +
            '<div class="user-status">● online' + (seen ? ' · ' + seen : '') + '</div></div>';
        usersList.appendChild(div);
    });
}

function renderTodos(todos) {
    if (!todoList) return;
    todoList.innerHTML = '';
    (todos || []).forEach((t) => {
        const li = document.createElement('li');
        li.className = 'todo-item' + (t.done ? ' done' : '');
        li.innerHTML =
            '<label><input type="checkbox" ' + (t.done ? 'checked' : '') + '> ' +
            escapeHtml(t.text) + '</label><button type="button" data-del="' + t.id + '">×</button>';
        li.querySelector('input').addEventListener('change', () => {
            socket.emit('todo_toggle', { room_id: ROOM_ID, id: t.id });
        });
        li.querySelector('[data-del]').addEventListener('click', () => {
            socket.emit('todo_delete', { room_id: ROOM_ID, id: t.id });
        });
        todoList.appendChild(li);
    });
}

function renderQueue(queue) {
    roomQueue = queue || [];
    if (!queueList) return;
    queueList.innerHTML = '';
    if (queueCount) queueCount.textContent = roomQueue.length ? '(' + roomQueue.length + ')' : '';
    roomQueue.forEach((q, i) => {
        const li = document.createElement('li');
        li.className = 'todo-item';
        li.innerHTML =
            '<span style="flex:1;font-size:0.85rem;">' + (i + 1) + '. ' + escapeHtml(q.title) +
            ' <span style="opacity:0.6;">· ' + escapeHtml(q.by || '') + '</span></span>' +
            '<button type="button">×</button>';
        li.querySelector('button').addEventListener('click', () => {
            socket.emit('queue_remove', { room_id: ROOM_ID, id: q.id });
        });
        queueList.appendChild(li);
    });
}

function appendMessage(msg) {
    const div = document.createElement('div');
    div.className = 'msg';
    let body = '';
    if (msg.type === 'image' && msg.media) {
        body = '<img class="chat-img" src="' + msg.media + '" alt="photo">';
    } else {
        body = '<div class="msg-body">' + escapeHtml(msg.message || '') + '</div>';
    }
    div.innerHTML =
        '<div class="msg-header"><span class="msg-name">' + escapeHtml(msg.name || '') +
        '</span><span class="msg-time">' + (msg.time || '') + '</span></div>' + body;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function showSystemMessage(text) {
    const div = document.createElement('div');
    div.className = 'msg';
    div.innerHTML =
        '<div class="msg-body" style="text-align:center;opacity:0.7;font-size:0.85rem;">' +
        escapeHtml(text) + '</div>';
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text == null ? '' : String(text);
    return div.innerHTML;
}

function showFloatingReaction(type) {
    const map = { hug: '🤗', kiss: '👋', missyou: '✨', heart: '👍' };
    const el = document.createElement('div');
    el.className = 'floating-reaction';
    el.textContent = map[type] || '✨';
    el.style.left = (20 + Math.random() * 60) + '%';
    el.style.bottom = '80px';
    reactionOverlay.appendChild(el);
    setTimeout(() => el.remove(), 2600);
}

btnPlayPause.addEventListener('click', () => {
    if (!player || !isPlayerReady || !currentVideoId) return;
    if (isPlaying) player.pauseVideo();
    else player.playVideo();
});

function seekBy(offset) {
    if (!player || !isPlayerReady || !currentVideoId) return;
    const t = Math.max(0, (player.getCurrentTime() || 0) + offset);
    player.seekTo(t, true);
    emitPlayerAction('seek', { current_time: t });
}
if (btnBack10) btnBack10.addEventListener('click', () => seekBy(-10));
if (btnFwd10) btnFwd10.addEventListener('click', () => seekBy(10));
if (btnNext) {
    btnNext.addEventListener('click', () => {
        socket.emit('queue_next', { room_id: ROOM_ID });
    });
}

seekBar.addEventListener('input', () => {
    if (!player || !isPlayerReady) return;
    const duration = player.getDuration() || 1;
    const time = (seekBar.value / 100) * duration;
    player.seekTo(time, true);
    emitPlayerAction('seek', { current_time: time });
});

setInterval(() => {
    if (!player || !isPlayerReady || !currentVideoId) return;
    try {
        const current = player.getCurrentTime() || 0;
        const duration = player.getDuration() || 0;
        if (duration > 0) {
            seekBar.value = (current / duration) * 100;
            currentTimeEl.textContent = formatTime(current);
            durationEl.textContent = formatTime(duration);
        }
    } catch (e) {}
}, 500);

function formatTime(sec) {
    sec = Math.floor(sec);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
}

function loadVideo(videoId, title = 'Unknown', broadcast = true) {
    currentVideoId = videoId;
    npTitle.textContent = title || 'Playing...';
    if (playerPlaceholder) playerPlaceholder.style.display = 'none';
    if (player && isPlayerReady) player.loadVideoById(videoId);
    else {
        const check = setInterval(() => {
            if (isPlayerReady) {
                player.loadVideoById(videoId);
                clearInterval(check);
            }
        }, 200);
    }
    if (broadcast) {
        socket.emit('player_action', {
            room_id: ROOM_ID,
            action: 'load',
            video_id: videoId,
            title: title
        });
    }
}

function extractVideoId(url) {
    const patterns = [
        /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
        /^([a-zA-Z0-9_-]{11})$/
    ];
    for (const p of patterns) {
        const match = url.match(p);
        if (match) return match[1];
    }
    return null;
}

searchBtn.addEventListener('click', handleSearch);
searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleSearch();
});

function handleSearch() {
    const q = searchInput.value.trim();
    if (!q) return;

    const videoId = extractVideoId(q);
    if (videoId) {
        searchResults.innerHTML =
            '<div class="search-item" style="padding:12px;">' +
            '<div class="info"><div class="title">YouTube link</div>' +
            '<div class="channel">' + escapeHtml(videoId) + '</div>' +
            '<div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">' +
            '<button type="button" class="mini-btn" id="urlPlayBtn">▶ Play now</button>' +
            '<button type="button" class="mini-btn" id="urlQueueBtn">＋ Add to queue</button>' +
            '</div></div></div>';

        document.getElementById('urlPlayBtn').onclick = () => {
            loadVideo(videoId, 'YouTube Video');
            searchInput.value = '';
            searchResults.innerHTML = '';
        };
        document.getElementById('urlQueueBtn').onclick = () => {
            socket.emit('queue_add', {
                room_id: ROOM_ID,
                video_id: videoId,
                title: 'YouTube · ' + videoId
            });
            showSystemMessage('Added to queue');
            searchInput.value = '';
            searchResults.innerHTML = '';
        };
        return;
    }
    performSearch(q);
}

async function performSearch(query) {
    searchResults.innerHTML = '<div style="padding:12px;color:var(--text-muted);">Searching...</div>';
    try {
        const instances = [
            'https://invidious.fdn.fr',
            'https://vid.puffyan.us',
            'https://invidious.projectsegfau.lt'
        ];
        let results = null;
        for (const base of instances) {
            try {
                const res = await fetch(base + '/api/v1/search?q=' + encodeURIComponent(query) + '&type=video');
                if (res.ok) {
                    results = await res.json();
                    break;
                }
            } catch (e) {}
        }
        if (!results || !results.length) {
            searchResults.innerHTML =
                '<div style="padding:14px;color:var(--text-muted);font-size:0.9rem;">Paste a YouTube link instead.</div>';
            return;
        }
        searchResults.innerHTML = '';
        results.slice(0, 8).forEach((item) => {
            const div = document.createElement('div');
            div.className = 'search-item';
            const thumb =
                (item.videoThumbnails && (item.videoThumbnails[3] || item.videoThumbnails[0]) || {}).url || '';
            div.innerHTML =
                '<img src="' + thumb + '" alt="" onerror="this.style.display=\'none\'">' +
                '<div class="info"><div class="title">' + escapeHtml(item.title) + '</div>' +
                '<div class="channel">' + escapeHtml(item.author || '') + '</div>' +
                '<div style="margin-top:6px;display:flex;gap:6px;">' +
                '<button type="button" class="mini-btn play-now">▶ Play</button>' +
                '<button type="button" class="mini-btn add-q">＋ Queue</button></div></div>';
            div.querySelector('.play-now').addEventListener('click', (e) => {
                e.stopPropagation();
                loadVideo(item.videoId, item.title);
                searchResults.innerHTML = '';
                searchInput.value = '';
            });
            div.querySelector('.add-q').addEventListener('click', (e) => {
                e.stopPropagation();
                socket.emit('queue_add', {
                    room_id: ROOM_ID,
                    video_id: item.videoId,
                    title: item.title
                });
                showSystemMessage('Queued: ' + item.title);
            });
            searchResults.appendChild(div);
        });
    } catch (err) {
        searchResults.innerHTML =
            '<div style="padding:14px;color:var(--text-muted);font-size:0.9rem;">Paste a YouTube link.</div>';
    }
}

function sendMessage() {
    const text = chatInput.value.trim();
    if (!text) return;
    socket.emit('chat_message', { room_id: ROOM_ID, type: 'text', message: text });
    chatInput.value = '';
}
sendBtn.addEventListener('click', sendMessage);
chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

document.querySelectorAll('.react-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
        const reaction = btn.dataset.reaction;
        socket.emit('send_reaction', { room_id: ROOM_ID, reaction });
        showFloatingReaction(reaction);
    });
});

document.querySelectorAll('.mood-btn[data-mood]').forEach((btn) => {
    btn.addEventListener('click', () => {
        socket.emit('set_mood', { room_id: ROOM_ID, mood: btn.dataset.mood });
    });
});

let notesTimer = null;
if (sharedNotes) {
    sharedNotes.addEventListener('input', () => {
        clearTimeout(notesTimer);
        notesTimer = setTimeout(() => {
            socket.emit('update_notes', { room_id: ROOM_ID, text: sharedNotes.value });
        }, 400);
    });
}

if (todoAddBtn && todoInput) {
    const addTodo = () => {
        const text = todoInput.value.trim();
        if (!text) return;
        socket.emit('todo_add', { room_id: ROOM_ID, text });
        todoInput.value = '';
    };
    todoAddBtn.addEventListener('click', addTodo);
    todoInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') addTodo();
    });
}

function compressImage(file, maxW, quality) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            const scale = Math.min(1, maxW / img.width);
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(img.width * scale);
            canvas.height = Math.round(img.height * scale);
            canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
            URL.revokeObjectURL(url);
            resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = reject;
        img.src = url;
    });
}

if (photoBtn && photoInput) {
    photoBtn.addEventListener('click', () => photoInput.click());
    photoInput.addEventListener('change', async () => {
        const file = photoInput.files && photoInput.files[0];
        photoInput.value = '';
        if (!file) return;
        try {
            const dataUrl = await compressImage(file, 800, 0.7);
            socket.emit('chat_message', {
                room_id: ROOM_ID,
                type: 'image',
                message: '',
                media: dataUrl
            });
        } catch (e) {
            alert('Could not send photo');
        }
    });
}

/* ========== LIVE CALL (WebRTC) ========== */
function setVoiceUI(state) {
    if (!micOnBtn) return;
    if (state === 'off') {
        micOnBtn.disabled = false;
        micMuteBtn.disabled = true;
        micOffBtn.disabled = true;
        micMuteBtn.textContent = '🔇 Mute';
        if (voiceLiveStatus) voiceLiveStatus.textContent = 'Mic off';
    } else if (state === 'live') {
        micOnBtn.disabled = true;
        micMuteBtn.disabled = false;
        micOffBtn.disabled = false;
        micMuteBtn.textContent = '🔇 Mute';
        if (voiceLiveStatus) voiceLiveStatus.textContent = 'Live — others can hear you';
    } else if (state === 'muted') {
        micOnBtn.disabled = true;
        micMuteBtn.disabled = false;
        micOffBtn.disabled = false;
        micMuteBtn.textContent = '🎙 Unmute';
        if (voiceLiveStatus) voiceLiveStatus.textContent = 'Muted';
    }
}

function ensureAudioEl(sid) {
    if (!remoteAudios) return null;
    let el = document.getElementById('audio-' + sid);
    if (!el) {
        el = document.createElement('audio');
        el.id = 'audio-' + sid;
        el.autoplay = true;
        el.playsInline = true;
        remoteAudios.appendChild(el);
    }
    return el;
}

function removeAudioEl(sid) {
    const el = document.getElementById('audio-' + sid);
    if (el) el.remove();
}

function createPeerConnection(sid) {
    if (pcs[sid]) return pcs[sid];
    const pc = new RTCPeerConnection(iceConfig);
    pcs[sid] = pc;

    if (localStream) {
        localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
    }

    pc.ontrack = (event) => {
        const el = ensureAudioEl(sid);
        if (el) {
            el.srcObject = event.streams[0];
            el.play().catch(() => {});
        }
    };

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('webrtc_signal', {
                to: sid,
                signal: { type: 'ice', candidate: event.candidate }
            });
        }
    };

    pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed' || pc.connectionState === 'disconnected') {
            closePeer(sid);
        }
    };

    return pc;
}

async function callPeer(sid) {
    try {
        const pc = createPeerConnection(sid);
        const offer = await pc.createOffer({ offerToReceiveAudio: true });
        await pc.setLocalDescription(offer);
        socket.emit('webrtc_signal', {
            to: sid,
            signal: { type: 'offer', sdp: pc.localDescription }
        });
    } catch (e) {
        console.error('callPeer', e);
    }
}

async function handleSignal(from, signal) {
    const pc = createPeerConnection(from);
    if (signal.type === 'offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('webrtc_signal', {
            to: from,
            signal: { type: 'answer', sdp: pc.localDescription }
        });
    } else if (signal.type === 'answer') {
        await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
    } else if (signal.type === 'ice' && signal.candidate) {
        try {
            await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
        } catch (e) {}
    }
}

function closePeer(sid) {
    if (pcs[sid]) {
        try { pcs[sid].close(); } catch (e) {}
        delete pcs[sid];
    }
    removeAudioEl(sid);
}

function closeAllPeers() {
    Object.keys(pcs).forEach(closePeer);
}

async function startMic() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true },
            video: false
        });
        voiceMuted = false;
        setVoiceUI('live');
        socket.emit('voice_join', { room_id: ROOM_ID });
    } catch (e) {
        alert('Mic permission needed (use HTTPS)');
        console.error(e);
        setVoiceUI('off');
    }
}

function toggleMute() {
    if (!localStream) return;
    voiceMuted = !voiceMuted;
    localStream.getAudioTracks().forEach((t) => { t.enabled = !voiceMuted; });
    setVoiceUI(voiceMuted ? 'muted' : 'live');
}

function stopMic() {
    if (localStream) {
        localStream.getTracks().forEach((t) => t.stop());
        localStream = null;
    }
    closeAllPeers();
    socket.emit('voice_leave', { room_id: ROOM_ID });
    voiceMuted = false;
    setVoiceUI('off');
}

if (micOnBtn) micOnBtn.addEventListener('click', startMic);
if (micMuteBtn) micMuteBtn.addEventListener('click', toggleMute);
if (micOffBtn) micOffBtn.addEventListener('click', stopMic);

socket.on('voice_peers', async (data) => {
    for (const sid of (data.peers || [])) {
        await callPeer(sid);
    }
});

socket.on('voice_left', (data) => {
    if (data && data.sid) closePeer(data.sid);
});

socket.on('webrtc_signal', async (data) => {
    if (!data || !data.from || !data.signal) return;
    try {
        await handleSignal(data.from, data.signal);
    } catch (e) {
        console.error('webrtc', e);
    }
});

setVoiceUI('off');

setInterval(() => {
    if (socket.connected) socket.emit('heartbeat', { room_id: ROOM_ID });
}, 30000);

function copyRoomCode() {
    navigator.clipboard.writeText(ROOM_ID).then(() => {
        showSystemMessage('Room code copied: ' + ROOM_ID);
    }).catch(() => {
        prompt('Copy room code:', ROOM_ID);
    });
}

function leaveRoom() {
    if (confirm('Leave this room?')) {
        stopMic();
        socket.disconnect();
        window.location.href = '/';
    }
}

window.copyRoomCode = copyRoomCode;
window.leaveRoom = leaveRoom;
window.onYouTubeIframeAPIReady = onYouTubeIframeAPIReady;
