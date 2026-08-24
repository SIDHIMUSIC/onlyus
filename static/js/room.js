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
window._moods = {};
window._lastSeen = {};

const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const searchResults = document.getElementById('searchResults');
const npTitle = document.getElementById('npTitle');
const playerPlaceholder = document.getElementById('playerPlaceholder');
const btnPlayPause = document.getElementById('btnPlayPause');
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
const tag = document.createElement('script');
tag.src = "https://www.youtube.com/iframe_api";
document.head.appendChild(tag);

function onPlayerStateChange(event) {
    if (isSyncing) return;
    if (event.data === YT.PlayerState.PLAYING) {
        isPlaying = true; btnPlayPause.textContent = '⏸'; emitPlayerAction('play');
    } else if (event.data === YT.PlayerState.PAUSED) {
        isPlaying = false; btnPlayPause.textContent = '▶️'; emitPlayerAction('pause');
    }
}

function emitPlayerAction(action, extra = {}) {
    if (!isPlayerReady || isSyncing) return;
    const currentTime = player.getCurrentTime ? player.getCurrentTime() : 0;
    socket.emit('player_action', {
        room_id: ROOM_ID, action, current_time: currentTime,
        video_id: currentVideoId, title: npTitle.textContent, ...extra
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

    if (data.player && data.player.video_id) {
        loadVideo(data.player.video_id, data.player.title, false);
        setTimeout(() => {
            if (player && player.seekTo) {
                isSyncing = true;
                player.seekTo(data.player.current_time || 0, true);
                if (data.player.is_playing) {
                    player.playVideo(); btnPlayPause.textContent = '⏸'; isPlaying = true;
                } else {
                    player.pauseVideo(); btnPlayPause.textContent = '▶️'; isPlaying = false;
                }
                setTimeout(() => isSyncing = false, 800);
            }
        }, 1200);
    }
    if (data.messages) {
        chatMessages.innerHTML = '';
        data.messages.forEach(msg => appendMessage(msg));
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

socket.on('player_sync', (data) => {
    if (data.from_sid === socket.id) return;
    isSyncing = true;
    if (data.action === 'load' && data.video_id) {
        loadVideo(data.video_id, data.title, false);
        setTimeout(() => {
            if (player) { player.seekTo(0, true); player.playVideo(); btnPlayPause.textContent = '⏸'; isPlaying = true; }
            isSyncing = false;
        }, 1000);
        return;
    }
    if (!player || !isPlayerReady) { isSyncing = false; return; }
    if (data.action === 'play') {
        player.seekTo(data.current_time || 0, true); player.playVideo();
        btnPlayPause.textContent = '⏸'; isPlaying = true;
    } else if (data.action === 'pause') {
        player.seekTo(data.current_time || 0, true); player.pauseVideo();
        btnPlayPause.textContent = '▶️'; isPlaying = false;
    } else if (data.action === 'seek') {
        player.seekTo(data.current_time || 0, true);
    }
    setTimeout(() => isSyncing = false, 600);
});

socket.on('new_message', appendMessage);
socket.on('reaction', (data) => showFloatingReaction(data.reaction, data.from));

socket.on('notes_sync', (data) => {
    if (data.from_sid === socket.id) return;
    if (sharedNotes && document.activeElement !== sharedNotes) sharedNotes.value = data.text || '';
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
    users.forEach(u => {
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
    (todos || []).forEach(t => {
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

function appendMessage(msg) {
    const div = document.createElement('div');
    div.className = 'msg';
    div.innerHTML =
        '<div class="msg-header"><span class="msg-name">' + escapeHtml(msg.name) +
        '</span><span class="msg-time">' + msg.time + '</span></div>' +
        '<div class="msg-body">' + escapeHtml(msg.message) + '</div>';
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function showSystemMessage(text) {
    const div = document.createElement('div');
    div.className = 'msg';
    div.innerHTML = '<div class="msg-body" style="text-align:center;opacity:0.7;font-size:0.85rem;">' +
        escapeHtml(text) + '</div>';
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
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
    if (isPlaying) player.pauseVideo(); else player.playVideo();
});
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
    const m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
}

function loadVideo(videoId, title = 'Unknown', broadcast = true) {
    currentVideoId = videoId;
    npTitle.textContent = title || 'Playing...';
    playerPlaceholder.style.display = 'none';
    if (player && isPlayerReady) player.loadVideoById(videoId);
    else {
        const check = setInterval(() => {
            if (isPlayerReady) { player.loadVideoById(videoId); clearInterval(check); }
        }, 200);
    }
    if (broadcast) {
        socket.emit('player_action', {
            room_id: ROOM_ID, action: 'load', video_id: videoId, title: title
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
searchInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') handleSearch(); });

function handleSearch() {
    const q = searchInput.value.trim();
    if (!q) return;
    const videoId = extractVideoId(q);
    if (videoId) {
        loadVideo(videoId, 'YouTube Video');
        searchInput.value = ''; searchResults.innerHTML = '';
        return;
    }
    performSearch(q);
}

async function performSearch(query) {
    searchResults.innerHTML = '<div style="padding:12px;color:var(--text-muted);">Searching...</div>';
    try {
        const instances = ['https://invidious.fdn.fr', 'https://vid.puffyan.us', 'https://invidious.projectsegfau.lt'];
        let results = null;
        for (const base of instances) {
            try {
                const res = await fetch(base + '/api/v1/search?q=' + encodeURIComponent(query) + '&type=video');
                if (res.ok) { results = await res.json(); break; }
            } catch (e) {}
        }
        if (!results || !results.length) {
            searchResults.innerHTML = '<div style="padding:14px;color:var(--text-muted);font-size:0.9rem;">Paste a YouTube link instead.</div>';
            return;
        }
        searchResults.innerHTML = '';
        results.slice(0, 8).forEach(item => {
            const div = document.createElement('div');
            div.className = 'search-item';
            const thumb = (item.videoThumbnails && (item.videoThumbnails[3] || item.videoThumbnails[0]) || {}).url || '';
            div.innerHTML = '<img src="' + thumb + '" alt="" onerror="this.style.display=\'none\'"><div class="info"><div class="title">' +
                escapeHtml(item.title) + '</div><div class="channel">' + escapeHtml(item.author || '') + '</div></div>';
            div.addEventListener('click', () => {
                loadVideo(item.videoId, item.title);
                searchResults.innerHTML = ''; searchInput.value = '';
            });
            searchResults.appendChild(div);
        });
    } catch (err) {
        searchResults.innerHTML = '<div style="padding:14px;color:var(--text-muted);font-size:0.9rem;">Paste a YouTube link.</div>';
    }
}

function sendMessage() {
    const text = chatInput.value.trim();
    if (!text) return;
    socket.emit('chat_message', { room_id: ROOM_ID, message: text });
    chatInput.value = '';
}
sendBtn.addEventListener('click', sendMessage);
chatInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });

document.querySelectorAll('.react-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const reaction = btn.dataset.reaction;
        socket.emit('send_reaction', { room_id: ROOM_ID, reaction });
        showFloatingReaction(reaction);
    });
});

document.querySelectorAll('.mood-btn').forEach(btn => {
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
    todoInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') addTodo(); });
}

setInterval(() => {
    if (socket.connected) socket.emit('heartbeat', { room_id: ROOM_ID });
}, 30000);

function copyRoomCode() {
    navigator.clipboard.writeText(ROOM_ID).then(() => {
        showSystemMessage('Room code copied: ' + ROOM_ID);
    }).catch(() => prompt('Copy room code:', ROOM_ID));
}
function leaveRoom() {
    if (confirm('Leave this room?')) {
        socket.disconnect();
        window.location.href = '/';
    }
}
window.copyRoomCode = copyRoomCode;
window.leaveRoom = leaveRoom;
window.onYouTubeIframeAPIReady = onYouTubeIframeAPIReady;
