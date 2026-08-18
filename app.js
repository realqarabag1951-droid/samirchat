const usernameScreen = document.getElementById("username-screen");
const chatScreen = document.getElementById("chat-screen");

const usernameInput = document.getElementById("username");
const usernameButton = document.getElementById("username-button");
const usernameError = document.getElementById("username-error");

const messageInput = document.getElementById("message");
const sendButton = document.getElementById("send-button");
const messages = document.getElementById("messages");
const usersList = document.getElementById("users");

let username = "";
let socket = null;

usernameButton.addEventListener("click", register);

usernameInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    register();
  }
});

sendButton.addEventListener("click", sendMessage);

messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    sendMessage();
  }
});

async function register() {
  const value = usernameInput.value.trim();

  usernameError.textContent = "";

  if (!/^[A-Za-z0-9_]{3,20}$/.test(value)) {
    usernameError.textContent =
      "Username 3-20 simvol olmalıdır. Yalnız hərf, rəqəm və _ istifadə et.";
    return;
  }

  usernameButton.disabled = true;
  usernameButton.textContent = "Yoxlanılır...";

  try {
    const response = await fetch("/api/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username: value,
      }),
    });

    const data = await response.json();

    if (!data.ok) {
      usernameError.textContent =
        data.error || "Bu username istifadə edilə bilmir.";
      return;
    }

    username = data.username;

    localStorage.setItem("samirchat_username", username);

    connectWebSocket();

    usernameScreen.style.display = "none";
    chatScreen.style.display = "block";
  } catch (error) {
    usernameError.textContent =
      "Serverə qoşulmaq mümkün olmadı. Bir az sonra yenidən yoxla.";
  } finally {
    usernameButton.disabled = false;
    usernameButton.textContent = "Çata daxil ol";
  }
}

function connectWebSocket() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";

  socket = new WebSocket(
    `${protocol}//${location.host}/ws?username=${encodeURIComponent(username)}`
  );

  socket.addEventListener("open", () => {
    addSystemMessage("Serverə qoşuldun.");
  });

  socket.addEventListener("message", (event) => {
    try {
      const data = JSON.parse(event.data);

      if (data.type === "message") {
        addMessage(data.username, data.text, data.time);
      }

      if (data.type === "system") {
        addSystemMessage(data.text);
      }

      if (data.type === "users" || data.type === "welcome") {
        updateUsers(data.users || []);
      }
    } catch {
      // Ignore invalid messages
    }
  });

  socket.addEventListener("close", () => {
    addSystemMessage("Serverlə əlaqə kəsildi.");
  });

  socket.addEventListener("error", () => {
    addSystemMessage("WebSocket bağlantısında problem yarandı.");
  });
}

function sendMessage() {
  const text = messageInput.value.trim();

  if (!text) return;

  if (!socket || socket.readyState !== WebSocket.OPEN) {
    addSystemMessage("Hazırda serverə qoşulu deyilsən.");
    return;
  }

  if (text.length > 500) {
    addSystemMessage("Mesaj maksimum 500 simvol ola bilər.");
    return;
  }

  socket.send(
    JSON.stringify({
      type: "message",
      text,
    })
  );

  messageInput.value = "";
  messageInput.focus();
}

function addMessage(sender, text, timestamp) {
  const item = document.createElement("div");
  item.className = "message";

  const name = document.createElement("strong");
  name.textContent = sender;

  const content = document.createElement("span");
  content.textContent = text;

  const time = document.createElement("small");
  time.textContent = new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  item.appendChild(name);
  item.appendChild(content);
  item.appendChild(time);

  messages.appendChild(item);

  messages.scrollTop = messages.scrollHeight;
}

function addSystemMessage(text) {
  const item = document.createElement("div");
  item.className = "system-message";
  item.textContent = text;

  messages.appendChild(item);
  messages.scrollTop = messages.scrollHeight;
}

function updateUsers(users) {
  usersList.innerHTML = "";

  for (const user of users) {
    const item = document.createElement("li");

    item.textContent =
      user === username
        ? `${user} (sən)`
        : user;

    usersList.appendChild(item);
  }
    }
