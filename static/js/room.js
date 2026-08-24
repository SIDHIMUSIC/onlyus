// OnlyUs - Room Logic
const socket = io();

let player = null;
let isPlayerReady = false;
let isSyncing = false;          // prevent feedback loops
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
            controls: 0,          // we use custom controls
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

// Load YouTube API
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
    socket.emit('join_room', {
        room_id: ROOM_ID,
        username: USERNAME,
        avatar: '💗'
    });
});

socket.on('room_state', (data) => {
    updateUsers(data.users);
    if (data.player && data.player.video_id) {
        loadVideo(data.player.video_id, data.player.title, false);
        // Sync time after load
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
    // Load recent messages
    if (data.messages) {
        data.messages.forEach(msg => appendMessage(msg));
    }
});

socket.on('user_joined', (data) => {
    updateUsers(data.users);
    showSystemMessage(`${data.user.name} joined 💕`);
});

socket.on('user_left', (data) => {
    updateUsers(data.users);
    showSystemMessage(`${data.name} left`);
});

socket.on('player_sync', (data) => {
... 
