// OnlyUs - Room Logic
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

// DOM
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

// ========== YouTube IFrame API ==========
function onYouTubeIframeAPIReady() {
    player = new YT.Player('player', {
        height: '100%',
        width: '100%',
        playerVars: {
            autoplay: 0,
            controls: 0,
            modestbranding: 1,
            rel: 0,
            fs: 1,
            playsinline: 1
        },
        events: {
            onReady: () => {
                isPlayerReady = true;
                console.log('YouTube player ready');
            },
            onStateChange: onPlayerStateChange
        }
    });
}

const tag = document.createElement('script');
tag.src = "https://www.youtube.com/iframe_api";
document.head.appendChild(tag);

function onPlayerStateChange(event) {
    if (isSyncing) return;

    const state = event.data;
    if (state === YT.PlayerState.PLAYING) {
        isPlaying = true;
        btnPlayPause.textContent = '⏸';
        emitPlayerAction('play');
    } else if (state === YT.PlayerState.PAUSED) {
        isPlaying = false;
        btnPlayPause.textContent = '▶️';
        emitPlayerAction('pause');
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

// ========== Socket Events ==========
socket.on('connect', () => {
    console.log('Connected to OnlyUs');
    userCount.textContent = 'Connected';
    socket.emit('join_room', {
        room_id: ROOM_ID,
        username: USERNAME,
        avatar: '💗'
    });
});

socket.on('connect_error', (err) => {
    console.error('Connection error:', err);
    userCount.textContent = 'Reconnecting...';
});

socket.on('disconnect', () => {
    userCount.textContent = 'Disconnected';
});

socket.on('room_state', (data) => {
    updateUsers(data.users);
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
                setTimeout(() => isSyncing = false, 800);
            }
        }, 1200);
    }
    if (data.messages) {
        data.messages.forEach(msg => appendMessage(msg));
    }
});

socket.on('user_joined', (data) => {
    updateUsers(data.users);
    showSystemMessage(data.user.name + ' joined 💕');
});

socket.on('user_left', (data) => {
    updateUsers(data.users);
    showSystemMessage(data.name + ' left');
});

socket.on('player_sync', (data) => {
    if (data.from_sid === socket.id) return;

    isSyncing = true;

    if (data.action === 'load' && data.video_id) {
        loadVideo(data.video_id, data.title, false);
        setTimeout(() => {
            if (player) {
                player.seekTo(0, true);
                player.playVideo();
                btnPlayPause.textContent = '⏸';
                isPlaying = true;
            }
            isSyncing = false;
        }, 1000);
        return;
    }

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

    setTimeout(() => isSyncing = false, 600);
});

socket.on('new_message', (msg) => {
    appendMessage(msg);
});

socket.on('reaction', (data) => {
    showFloatingReaction(data.reaction, data.from);
});

// ========== UI Helpers ==========
function updateUsers(users) {
    usersList.innerHTML = '';
    if (!users || users.length === 0) {
        userCount.textContent = 'Waiting...';
        return;
    }
    userCount.textContent = users.length + ' online';
    users.forEach(u => {
        const div = document.createElement('div');
        div.className = 'user-item';
        div.innerHTML = '<span class="user-avatar">' + (u.avatar || '💗') + '</span><div><div class="user-name">' + escapeHtml(u.name) + '</div><div class="user-status">● online</div></div>';
        usersList.appendChild(div);
    });
}

function appendMessage(msg) {
    const div = document.createElement('div');
    div.className = 'msg';
    div.innerHTML = '<div class="msg-header"><span class="msg-name">' + escapeHtml(msg.name) + '</span><span class="msg-time">' + msg.time + '</span></div><div class="msg-body">' + escapeHtml(msg.message) + '</div>';
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function showSystemMessage(text) {
    const div = document.createElement('div');
    div.className = 'msg';
    div.innerHTML = '<div class="msg-body" style="text-align:center;opacity:0.7;font-size:0.85rem;">' + escapeHtml(text) + '</div>';
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showFloatingReaction(type, from) {
    const map = {
        hug: '🤗',
        kiss: '💋',
        missyou: '🥺',
        heart: '💖'
    };
    const emoji = map[type] || '💖';
    const el = document.createElement('div');
    el.className = 'floating-reaction';
    el.textContent = emoji;
    el.style.left = (20 + Math.random() * 60) + '%';
    el.style.bottom = '80px';
    reactionOverlay.appendChild(el);
    setTimeout(() => el.remove(), 2600);
}

// ========== Player Controls ==========
btnPlayPause.addEventListener('click', () => {
    if (!player || !isPlayerReady || !currentVideoId) return;
    if (isPlaying) {
        player.pauseVideo();
    } else {
        player.playVideo();
    }
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
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
}

// ========== Load Video ==========
function loadVideo(videoId, title = 'Unknown', broadcast = true) {
    currentVideoId = videoId;
    npTitle.textContent = title || 'Playing...';
    playerPlaceholder.style.display = 'none';

    if (player && isPlayerReady) {
        player.loadVideoById(videoId);
    } else {
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

// ========== Search ==========
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
        loadVideo(videoId, 'YouTube Video');
        searchInput.value = '';
        searchResults.innerHTML = '';
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

        if (!results || results.length === 0) {
            searchResults.innerHTML = '<div style="padding:14px;color:var(--text-muted);font-size:0.9rem;">Search temporarily unavailable.<br><strong>Tip:</strong> Paste any YouTube link directly 🎵</div>';
            return;
        }

        searchResults.innerHTML = '';
        results.slice(0, 8).forEach(item => {
            const div = document.createElement('div');
            div.className = 'search-item';
            const thumb = (item.videoThumbnails && item.videoThumbnails[3] && item.videoThumbnails[3].url) || (item.videoThumbnails && item.videoThumbnails[0] && item.videoThumbnails[0].url) || '';
            div.innerHTML = '<img src="' + thumb + '" alt="" onerror="this.style.display=\'none\'"><div class="info"><div class="title">' + escapeHtml(item.title) + '</div><div class="channel">' + escapeHtml(item.author || '') + '</div></div>';
            div.addEventListener('click', () => {
                loadVideo(item.videoId, item.title);
                searchResults.innerHTML = '';
                searchInput.value = '';
            });
            searchResults.appendChild(div);
        });
    } catch (err) {
        searchResults.innerHTML = '<div style="padding:14px;color:var(--text-muted);font-size:0.9rem;">Could not search right now.<br>Just paste a YouTube link instead ✨</div>';
    }
}

// ========== Chat ==========
function sendMessage() {
    const text = chatInput.value.trim();
    if (!text) return;
    socket.emit('chat_message', {
        room_id: ROOM_ID,
        message: text
    });
    chatInput.value = '';
}

sendBtn.addEventListener('click', sendMessage);
chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

// ========== Reactions ==========
document.querySelectorAll('.react-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const reaction = btn.dataset.reaction;
        socket.emit('send_reaction', {
            room_id: ROOM_ID,
            reaction
        });
        showFloatingReaction(reaction, USERNAME);
    });
});

window.onYouTubeIframeAPIReady = onYouTubeIframeAPIReady;
