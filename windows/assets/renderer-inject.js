((cssText, artDataUrl, rawConfig) => {
  const STATE_KEY = "__CODEX_DREAM_SKIN_STATE__";
  const STYLE_ID = "codex-dream-skin-style";
  const CHROME_ID = "codex-dream-skin-chrome";
  const ROOT_CLASSES = [
    "codex-dream-skin",
    "dream-theme-light",
    "dream-theme-dark",
    "dream-art-wide",
    "dream-art-standard",
    "dream-focus-left",
    "dream-focus-center",
    "dream-focus-right",
    "dream-safe-left",
    "dream-safe-center",
    "dream-safe-right",
    "dream-safe-none",
    "dream-task-ambient",
    "dream-task-banner",
    "dream-task-off",
    "retro-chatgpt-mode",
  ];
  const ROOT_PROPERTIES = [
    "--dream-art",
    "--dream-art-position",
    "--dream-focus-x",
    "--dream-focus-y",
    "--dream-accent",
    "--dream-accent-ink",
    "--dream-image-luma",
    "--retro-left-live-width",
  ];
  const HOME_UTILITY_CLASS = "dream-home-utility";
  const installToken = {};
  let samplingNativeShell = false;
  let observer = null;
  const friendMenuAbort = typeof AbortController === "function"
    ? new AbortController()
    : { abort() {}, signal: undefined };
  window.__CODEX_DREAM_SKIN_DISABLED__ = false;

  const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, Number(value)));
  const luminance = (red, green, blue) => {
    const linear = [red, green, blue].map((value) => {
      const channel = value / 255;
      return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
    });
    return .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2];
  };
  const defaultProfile = {
    appearance: "dark",
    accent: [108, 131, 142],
    focusX: .5,
    focusY: .5,
    aspect: 1.6,
    luma: .32,
    safeArea: "center",
  };

  const normalizeConfig = (value) => {
    const config = value && typeof value === "object" ? value : {};
    const art = config.art && typeof config.art === "object" ? config.art : {};
    const hasNumber = (candidate) =>
      (typeof candidate === "number" || (typeof candidate === "string" && candidate.trim() !== "")) &&
      Number.isFinite(Number(candidate));
    const requestedAccent = typeof config?.palette?.accent === "string"
      ? config.palette.accent.trim()
      : "";
    const safeAccent = /^(?:#[\da-f]{3,8}|(?:rgb|hsl|oklch|oklab)\([^;{}]{1,96}\))$/i.test(requestedAccent)
      ? requestedAccent
      : null;
    const appearance = ["auto", "light", "dark"].includes(config.appearance)
      ? config.appearance
      : "auto";
    const safeArea = ["auto", "left", "right", "center", "none"].includes(art.safeArea)
      ? art.safeArea
      : "auto";
    const taskMode = ["auto", "ambient", "banner", "off"].includes(art.taskMode)
      ? art.taskMode
      : "auto";
    const metadataRatio = Number(config?.artMetadata?.ratio);
    return {
      appearance,
      safeArea,
      taskMode,
      focusX: hasNumber(art.focusX) ? clamp(art.focusX) : null,
      focusY: hasNumber(art.focusY) ? clamp(art.focusY) : null,
      accent: safeAccent,
      initialAspect: Number.isFinite(metadataRatio) && metadataRatio > 0 ? metadataRatio : null,
    };
  };

  const previous = window[STATE_KEY];
  if (previous?.observer) previous.observer.disconnect();
  if (previous?.timer) clearInterval(previous.timer);
  if (previous?.scheduler?.timeout) clearTimeout(previous.scheduler.timeout);
  if (previous?.onResize) window.removeEventListener?.("resize", previous.onResize);
  previous?.friendMenuAbort?.abort();
  if (previous?.artUrl) URL.revokeObjectURL(previous.artUrl);
  const artUrl = (() => {
    const comma = artDataUrl.indexOf(",");
    const binary = atob(artDataUrl.slice(comma + 1));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    const mime = /^data:([^;,]+)/.exec(artDataUrl)?.[1] || "image/png";
    return URL.createObjectURL(new Blob([bytes], { type: mime }));
  })();
  const config = normalizeConfig(rawConfig);
  let profile = {
    ...defaultProfile,
    aspect: config.initialAspect ?? defaultProfile.aspect,
  };
  const existingStyle = document.getElementById(STYLE_ID);
  if (existingStyle) {
    existingStyle.textContent = cssText;
    existingStyle.dataset.dreamVersion = "3";
  }

  const analyzeArt = () => new Promise((resolve) => {
    if (typeof Image !== "function") {
      resolve(defaultProfile);
      return;
    }
    const image = new Image();
    image.onload = () => {
      try {
        const width = 48;
        const height = Math.max(12, Math.round(width * image.naturalHeight / image.naturalWidth));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext?.("2d", { willReadFrequently: true });
        if (!context) throw new Error("Canvas is unavailable");
        context.drawImage(image, 0, 0, width, height);
        const pixels = context.getImageData(0, 0, width, height).data;
        let count = 0;
        let totalRed = 0;
        let totalGreen = 0;
        let totalBlue = 0;
        let totalBrightness = 0;
        const samples = [];
        const sampleMap = new Array(width * height);
        for (let offset = 0; offset < pixels.length; offset += 4) {
          if (pixels[offset + 3] < 96) continue;
          const red = pixels[offset];
          const green = pixels[offset + 1];
          const blue = pixels[offset + 2];
          const light = (.2126 * red + .7152 * green + .0722 * blue) / 255;
          const sample = { red, green, blue, light, index: offset / 4 };
          samples.push(sample);
          sampleMap[sample.index] = sample;
          totalRed += red;
          totalGreen += green;
          totalBlue += blue;
          totalBrightness += light;
          count += 1;
        }
        if (!count) throw new Error("Image contains no opaque pixels");
        const average = [totalRed / count, totalGreen / count, totalBlue / count];
        const averageBrightness = totalBrightness / count;
        const information = (start, end) => {
          let total = 0;
          let totalSquared = 0;
          let edges = 0;
          let edgeCount = 0;
          let sampleCount = 0;
          for (let y = 0; y < height; y += 1) {
            for (let x = start; x < end; x += 1) {
              const sample = sampleMap[y * width + x];
              if (!sample) continue;
              total += sample.light;
              totalSquared += sample.light * sample.light;
              sampleCount += 1;
              const previousSample = x > start ? sampleMap[y * width + x - 1] : null;
              const above = y > 0 ? sampleMap[(y - 1) * width + x] : null;
              if (previousSample) { edges += Math.abs(sample.light - previousSample.light); edgeCount += 1; }
              if (above) { edges += Math.abs(sample.light - above.light); edgeCount += 1; }
            }
          }
          const mean = sampleCount ? total / sampleCount : 0;
          const variance = sampleCount ? Math.max(0, totalSquared / sampleCount - mean * mean) : 1;
          return Math.sqrt(variance) * .58 + (edgeCount ? edges / edgeCount : 1) * .42;
        };
        const zoneWidth = Math.max(1, Math.floor(width * .38));
        const leftInformation = information(0, zoneWidth);
        const rightInformation = information(width - zoneWidth, width);
        let safeArea = "center";
        if (leftInformation < rightInformation * .86) safeArea = "left";
        else if (rightInformation < leftInformation * .86) safeArea = "right";
        let focusWeight = 0;
        let focusX = 0;
        let focusY = 0;
        let accentWeight = 0;
        let accent = [0, 0, 0];
        for (const sample of samples) {
          const x = sample.index % width;
          const y = Math.floor(sample.index / width);
          const difference = Math.sqrt(
            (sample.red - average[0]) ** 2 +
            (sample.green - average[1]) ** 2 +
            (sample.blue - average[2]) ** 2,
          ) / 441.7;
          const saliency = .03 + difference ** 1.35;
          focusX += (x / Math.max(1, width - 1)) * saliency;
          focusY += (y / Math.max(1, height - 1)) * saliency;
          focusWeight += saliency;
          const max = Math.max(sample.red, sample.green, sample.blue);
          const min = Math.min(sample.red, sample.green, sample.blue);
          const saturation = max ? (max - min) / max : 0;
          const usableLight = 1 - Math.min(1, Math.abs(sample.light - .46) / .54);
          const weight = saturation ** 2 * (.15 + usableLight);
          accent[0] += sample.red * weight;
          accent[1] += sample.green * weight;
          accent[2] += sample.blue * weight;
          accentWeight += weight;
        }
        const resolvedAccent = accentWeight > 1
          ? accent.map((channel) => Math.round(channel / accentWeight))
          : average.map((channel) => Math.round(channel));
        let resolvedFocusX = clamp(focusX / focusWeight);
        if (safeArea === "left") resolvedFocusX = Math.max(.64, resolvedFocusX);
        if (safeArea === "right") resolvedFocusX = Math.min(.36, resolvedFocusX);
        resolve({
          appearance: averageBrightness >= .58 ? "light" : "dark",
          accent: resolvedAccent,
          focusX: resolvedFocusX,
          focusY: clamp(focusY / focusWeight),
          aspect: image.naturalWidth / Math.max(1, image.naturalHeight),
          luma: clamp(averageBrightness),
          safeArea,
        });
      } catch {
        resolve(defaultProfile);
      }
    };
    image.onerror = () => resolve(defaultProfile);
    image.src = artUrl;
  });

  const detectShellAppearance = () => {
    const root = document.documentElement;
    const body = document.body;
    const classes = `${root?.className || ""} ${body?.className || ""}`
      .toLowerCase()
      .replace(/\bdream-theme-(?:dark|light)\b/g, "");
    if (/\b(dark|electron-dark|theme-dark|appearance-dark)\b/.test(classes)) return "dark";
    if (/\b(light|electron-light|theme-light|appearance-light)\b/.test(classes)) return "light";

    const dataTheme = (
      root?.getAttribute?.("data-theme") ||
      root?.getAttribute?.("data-appearance") ||
      root?.getAttribute?.("data-color-mode") ||
      body?.getAttribute?.("data-theme") ||
      body?.getAttribute?.("data-appearance") ||
      ""
    ).toLowerCase();
    if (dataTheme.includes("dark")) return "dark";
    if (dataTheme.includes("light")) return "light";

    try {
      const hadSkin = root?.classList?.contains?.("codex-dream-skin");
      const savedSkinClasses = hadSkin
        ? ROOT_CLASSES.filter((className) => root.classList.contains(className))
        : [];
      samplingNativeShell = true;
      if (hadSkin) root.classList.remove(...ROOT_CLASSES);
      try {
        const colorScheme = getComputedStyle(root).colorScheme || "";
        if (colorScheme.includes("dark") && !colorScheme.includes("light")) return "dark";
        if (colorScheme.includes("light") && !colorScheme.includes("dark")) return "light";
      } finally {
        if (hadSkin) root.classList.add(...savedSkinClasses);
        observer?.takeRecords?.();
        samplingNativeShell = false;
      }
    } catch {
      samplingNativeShell = false;
    }
    try {
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    } catch {}
    return "light";
  };

  const clearSkinDom = () => {
    const root = document.documentElement;
    root?.classList.remove(...ROOT_CLASSES);
    for (const property of ROOT_PROPERTIES) root?.style.removeProperty(property);
    document.querySelectorAll(".dream-home").forEach((node) => node.classList.remove("dream-home"));
    document.querySelectorAll(".dream-task").forEach((node) => node.classList.remove("dream-task"));
    document.querySelectorAll(".dream-home-shell").forEach((node) => node.classList.remove("dream-home-shell"));
    document.querySelectorAll(`.${HOME_UTILITY_CLASS}`).forEach((node) => node.classList.remove(HOME_UTILITY_CLASS));
    document.querySelectorAll(".retro-user-bubble, .retro-assistant-bubble").forEach((node) => {
      node.classList.remove("retro-user-bubble", "retro-assistant-bubble");
    });
    document.querySelectorAll(".retro-bubble-avatar").forEach((node) => node.remove());
    document.querySelectorAll(".retro-native-task-hit").forEach((node) => {
      node.classList.remove("retro-native-task-hit");
      for (const property of [
        "--retro-native-task-x",
        "--retro-native-task-y",
        "--retro-native-task-width",
        "--retro-native-task-height",
      ]) node.style.removeProperty(property);
    });
    document.getElementById(STYLE_ID)?.remove();
    document.getElementById(CHROME_ID)?.remove();
  };

  const applyProfile = (root) => {
    const focusX = config.focusX ?? profile.focusX;
    const focusY = config.focusY ?? profile.focusY;
    const appearance = config.appearance === "auto" ? detectShellAppearance() : config.appearance;
    const focus = focusX < .4 ? "left" : focusX > .6 ? "right" : "center";
    const safeArea = config.safeArea === "auto" ? (profile.safeArea ||
      (focus === "left" ? "right" : focus === "right" ? "left" : "center")) : config.safeArea;
    const taskMode = config.taskMode === "auto"
      ? profile.aspect >= 2.25 ? "banner" : "ambient"
      : config.taskMode;
    const accent = config.accent || `rgb(${profile.accent.join(" ")})`;
    const accentInk = luminance(...profile.accent) > .42 ? "rgb(26 24 28)" : "rgb(250 248 251)";
    root.classList.toggle("dream-theme-light", appearance === "light");
    root.classList.toggle("dream-theme-dark", appearance === "dark");
    root.classList.toggle("dream-art-wide", profile.aspect >= 1.75);
    root.classList.toggle("dream-art-standard", profile.aspect < 1.75);
    for (const value of ["left", "center", "right"]) {
      root.classList.toggle(`dream-focus-${value}`, focus === value);
    }
    for (const value of ["left", "center", "right", "none"]) {
      root.classList.toggle(`dream-safe-${value}`, safeArea === value);
    }
    for (const value of ["ambient", "banner", "off"]) {
      root.classList.toggle(`dream-task-${value}`, taskMode === value);
    }
    root.style.setProperty("--dream-art", `url("${artUrl}")`);
    root.style.setProperty("--dream-art-position", `${Math.round(focusX * 100)}% ${Math.round(focusY * 100)}%`);
    root.style.setProperty("--dream-focus-x", String(focusX));
    root.style.setProperty("--dream-focus-y", String(focusY));
    root.style.setProperty("--dream-accent", accent);
    root.style.setProperty("--dream-accent-ink", accentInk);
    root.style.setProperty("--dream-image-luma", profile.luma.toFixed(3));
  };

  const RETRO_SHELL_VERSION = "full-ui-v28";

  const ensureRetroChrome = (chrome) => {
    let shell = chrome.querySelector(".candy-shell");
    if (shell && shell.dataset.retroVersion !== RETRO_SHELL_VERSION) {
      shell.remove();
      shell = null;
    }
    if (!shell) {
      shell = document.createElement("div");
      shell.className = "candy-shell";
      shell.dataset.retroVersion = RETRO_SHELL_VERSION;
      shell.innerHTML = `
        <aside class="retro-left-rail">
          <header class="retro-left-title">
            <span class="candy-left-mascot" aria-hidden="true"></span>
            <span class="retro-left-title-copy"><b>糖果工作间</b><small>今天也在认真敲代码</small></span>
            <button class="retro-left-mode-switch" data-retro-action="mode" title="切换 Codex / ChatGPT"><span data-retro-mode-label>Codex</span><i>⌄</i></button>
          </header>
          <div class="retro-left-scroll">
            <nav class="retro-left-nav">
              <button data-retro-action="new"><i class="nav-new">＋</i><span>新建任务</span></button>
              <button data-retro-action="scheduled"><i class="nav-scheduled">◷</i><span>已安排</span></button>
              <button data-retro-action="plugin"><i class="nav-plugin">✿</i><span>插件</span></button>
              <button data-retro-action="site"><i class="nav-site">▧</i><span>站点</span></button>
              <button data-retro-action="pr"><i class="nav-pr">⌘</i><span>拉取请求</span></button>
              <button data-retro-action="chat"><i class="nav-chat">●</i><span>聊天</span></button>
            </nav>
            <div class="retro-left-section retro-sticker-yellow"><b>置顶</b><button data-retro-section-toggle="pinned" aria-label="折叠置顶" aria-expanded="true">⌃</button></div>
            <div class="retro-left-section-body" data-retro-section-body="pinned">
              <div class="retro-left-pinned">
                <button data-retro-action="project"><i class="retro-folder-icon"></i><span>Codex Dream Skin</span></button>
              </div>
            </div>
            <div class="retro-left-section retro-sticker-mint"><b>项目</b><button data-retro-section-toggle="project" aria-label="折叠项目" aria-expanded="true">⌃</button></div>
            <div class="retro-left-section-body" data-retro-section-body="project">
              <button class="retro-left-project" data-retro-action="project"><i class="retro-folder-icon"></i><span>当前项目</span><em>进行中</em></button>
            </div>
            <div class="retro-left-section retro-left-section-compact retro-sticker-blue"><b>展开提示</b><button data-retro-section-toggle="hint" aria-label="折叠展开提示" aria-expanded="false">⌄</button></div>
            <div class="retro-left-section-body retro-section-collapsed" data-retro-section-body="hint"><p class="retro-left-expand-note">点击任务便签，就能继续对应的工作现场。</p></div>
            <div class="retro-left-section retro-sticker-pink"><b>任务</b><button data-retro-section-toggle="tasks" aria-label="折叠任务" aria-expanded="true">⌃</button></div>
            <div class="retro-left-section-body" data-retro-section-body="tasks"><div class="retro-left-task-list" data-retro-task-list></div></div>
          </div>
          <button class="retro-left-profile" data-retro-action="profile"><span class="retro-left-profile-avatar"></span><span class="retro-left-profile-copy"><b data-retro-profile-name>Codex 用户</b><small><i></i> 在线 · 工作间主人</small></span><em>⌄</em></button>
          <button class="retro-left-search" data-retro-action="search"><span>⌕</span><em>找找任务或文件…</em><i>↵</i></button>
        </aside>
        <div class="retro-main-caption"><span>▧</span><b data-retro-main-title>Codex 任务</b></div>
        <div class="retro-toolbar">
          <div class="retro-tool"><span class="retro-tool-icon retro-tool-new">＋</span><span>新建任务</span></div>
          <div class="retro-tool"><span class="retro-tool-icon retro-tool-plan">▣</span><span>已安排</span></div>
          <i class="retro-tool-separator"></i>
          <div class="retro-tool"><span class="retro-tool-icon retro-tool-plugin">✿</span><span>插件</span></div>
          <div class="retro-tool"><span class="retro-tool-icon retro-tool-site">▧</span><span>站点</span></div>
          <div class="retro-tool"><span class="retro-tool-icon retro-tool-pr">⌘</span><span>拉取请求</span></div>
          <div class="retro-tool"><span class="retro-tool-icon retro-tool-chat">●</span><span>聊天</span></div>
        </div>
        <aside class="retro-right-rail">
          <section class="retro-contact-card retro-codex-card">
            <div class="retro-profile-sky">
              <i class="retro-star star-a">★</i><i class="retro-star star-b">✦</i><i class="retro-star star-c">★</i>
              <div class="candy-sprout candy-sprout-stage" aria-hidden="true"></div>
              <span class="retro-profile-nameplate"><i></i><b>芽芽助手</b></span>
              <em class="retro-profile-level">LV 07</em>
            </div>
            <p class="retro-bot-bubble"><b>代码有问题？找我！</b><span>一起写代码、改 Bug、查文档。</span></p>
            <div class="retro-card-icons" aria-label="好友功能">
              <button type="button" class="retro-jelly-icon jelly-message" title="消息"><span>✉</span></button>
              <button type="button" class="retro-jelly-icon jelly-star" title="收藏"><span>★</span></button>
              <button type="button" class="retro-jelly-icon jelly-mail" title="邮件"><span>▣</span></button>
              <button type="button" class="retro-jelly-icon jelly-flower" title="装扮"><span>✿</span></button>
              <button type="button" class="retro-jelly-icon jelly-more" title="更多"><span>◆</span></button>
            </div>
          </section>
          <nav class="retro-friend-tabs" data-retro-friend-tabs aria-label="好友分类">
            <button type="button" class="retro-friend-tab retro-friend-tab-active" data-retro-friend-tab="friends" aria-selected="true">好友</button>
            <button type="button" class="retro-friend-tab" data-retro-friend-tab="groups" aria-selected="false">群聊</button>
            <button type="button" class="retro-friend-tab" data-retro-friend-tab="recent" aria-selected="false">最近</button>
          </nav>
          <section class="retro-contact-card retro-friends-card">
            <header class="retro-friends-toggle" data-retro-friends-toggle role="button" tabindex="0"><span class="retro-list-sprout">♧</span><b>糖果好友 · 7/8</b><span class="retro-collapse-bubble" data-retro-friends-arrow>⌄</span></header>
            <div class="retro-friend-tab-panel" data-retro-friend-panel="friends">
              <div class="retro-friend-list">
                <div class="retro-friend" data-retro-friend-name="桃桃" data-retro-friend-status="在线" role="button" tabindex="0"><span class="retro-friend-avatar avatar-strawberry"></span><div><b>桃桃</b><small class="retro-online"><i></i> 正在整理糖果</small></div></div>
                <div class="retro-friend" data-retro-friend-name="芽芽助手" data-retro-friend-status="在线" role="button" tabindex="0"><span class="retro-friend-avatar sprout"><i class="candy-sprout"></i></span><div><b>芽芽助手</b><small class="retro-online"><i></i> 随时可以帮忙</small></div></div>
                <div class="retro-friend" data-retro-friend-name="云朵" data-retro-friend-status="离开" role="button" tabindex="0"><span class="retro-friend-avatar avatar-cloud"></span><div><b>云朵</b><small class="retro-away"><i></i> 出去散散步</small></div></div>
                <div class="retro-friend" data-retro-friend-name="星糖" data-retro-friend-status="在线" role="button" tabindex="0"><span class="retro-friend-avatar avatar-star"></span><div><b>星糖</b><small class="retro-online"><i></i> 今天也闪闪发光</small></div></div>
                <div class="retro-friend" data-retro-friend-name="薄荷" data-retro-friend-status="忙碌" role="button" tabindex="0"><span class="retro-friend-avatar avatar-mint"></span><div><b>薄荷</b><small class="retro-busy"><i></i> 正在专心工作</small></div></div>
                <div class="retro-friend" data-retro-friend-name="布丁" data-retro-friend-status="离线" role="button" tabindex="0"><span class="retro-friend-avatar avatar-pudding"></span><div><b>布丁</b><small class="retro-stealth"><i></i> 现在不在线</small></div></div>
                <div class="retro-friend" data-retro-friend-name="栗子" data-retro-friend-status="忙碌" role="button" tabindex="0"><span class="retro-friend-avatar avatar-cookie"></span><div><b>栗子</b><small class="retro-busy"><i></i> 正在烤小饼干</small></div></div>
              </div>
              <div class="retro-friend-search">找找好友… <span>⌕</span></div>
            </div>
            <div class="retro-friend-tab-empty" data-retro-friend-panel="groups" hidden><span>🍬</span><b>群聊糖罐还是空的</b><small>以后的小伙伴会住在这里</small></div>
            <div class="retro-friend-tab-empty" data-retro-friend-panel="recent" hidden><span>☁</span><b>最近还没有新消息</b><small>聊过的朋友会轻轻落在这里</small></div>
          </section>
        </aside>
        <div class="retro-friend-flyout" data-retro-friend-flyout role="menu" aria-hidden="true">
          <div class="retro-friend-flyout-title"><i></i><b data-retro-flyout-name>好友</b><small data-retro-flyout-status></small></div>
          <button type="button" role="menuitem" data-retro-friend-command="message"><i class="retro-flyout-icon retro-flyout-message">✉</i><span>发送消息</span><kbd>Enter</kbd></button>
          <button type="button" role="menuitem" data-retro-friend-command="profile"><i class="retro-flyout-icon retro-flyout-profile">♙</i><span>查看资料</span></button>
          <div class="retro-friend-flyout-separator"></div>
          <button type="button" role="menuitem" data-retro-friend-command="favorite"><i class="retro-flyout-icon retro-flyout-favorite">★</i><span>设为特别关心</span></button>
          <button type="button" role="menuitem" data-retro-friend-command="mute"><i class="retro-flyout-icon retro-flyout-mute">×</i><span>屏蔽此人</span></button>
        </div>
        <div class="retro-friend-toast" data-retro-friend-toast aria-live="polite"></div>
        <footer class="retro-status-bar">
          <div class="retro-status-icons" aria-label="糖果快捷入口">
            <span class="retro-status-icon icon-0" title="糖果主页"></span>
            <span class="retro-status-icon icon-1" title="联系人"></span>
            <span class="retro-status-icon icon-2" title="收藏"></span>
            <span class="retro-status-icon icon-3" title="邮箱"></span>
            <span class="retro-status-icon icon-4" title="文件"></span>
            <span class="retro-status-icon icon-5" title="助手"></span>
            <span class="retro-status-icon icon-6" title="应用"></span>
            <span class="retro-status-icon icon-7" title="更多"></span>
          </div>
          <span class="retro-status-spacer"></span>
          <div class="retro-status-state" aria-label="工作台状态">
            <span class="retro-status-safe">安全</span>
            <span class="retro-status-candy retro-status-notice" title="通知">▥</span>
            <span class="retro-status-candy retro-status-flower" title="小花状态">✿</span>
            <time class="retro-status-clock" data-retro-clock></time>
          </div>
        </footer>`;
      chrome.appendChild(shell);
    }
    if (shell.dataset.retroFriendsWired !== "true") {
      shell.dataset.retroFriendsWired = "true";
      const toggleFriends = () => {
        const card = shell.querySelector(".retro-friends-card");
        if (!card) return;
        const collapsed = card.classList.toggle("retro-friends-collapsed");
        const arrow = card.querySelector("[data-retro-friends-arrow]");
        if (arrow) arrow.textContent = collapsed ? "›" : "⌄";
      };
      shell.querySelector("[data-retro-friends-toggle]")?.addEventListener("click", toggleFriends);
      shell.querySelector("[data-retro-friends-toggle]")?.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        toggleFriends();
      });

      const flyout = shell.querySelector("[data-retro-friend-flyout]");
      const toast = shell.querySelector("[data-retro-friend-toast]");
      let activeFriend = null;
      let toastTimer = null;
      const setMenuLabel = (command, label) => {
        const node = flyout?.querySelector(`[data-retro-friend-command="${command}"] span`);
        if (node) node.textContent = label;
      };
      const closeFriendMenu = ({ restoreFocus = false } = {}) => {
        if (!flyout) return;
        flyout.classList.remove("retro-friend-flyout-open");
        flyout.setAttribute("aria-hidden", "true");
        activeFriend?.classList.remove("retro-friend-menu-open");
        activeFriend?.setAttribute("aria-expanded", "false");
        if (restoreFocus) activeFriend?.focus();
        activeFriend = null;
      };
      const selectFriendTab = (tab) => {
        const tabName = tab?.dataset.retroFriendTab;
        if (!tabName) return;
        for (const candidate of shell.querySelectorAll("[data-retro-friend-tab]")) {
          const selected = candidate === tab;
          candidate.classList.toggle("retro-friend-tab-active", selected);
          candidate.setAttribute("aria-selected", selected ? "true" : "false");
        }
        for (const panel of shell.querySelectorAll("[data-retro-friend-panel]")) {
          panel.hidden = panel.dataset.retroFriendPanel !== tabName;
        }
        closeFriendMenu();
      };
      for (const tab of shell.querySelectorAll("[data-retro-friend-tab]")) {
        tab.addEventListener("click", () => selectFriendTab(tab));
      }
      const positionFriendMenu = (friend) => {
        if (!flyout) return;
        const rect = friend.getBoundingClientRect();
        const menuRect = flyout.getBoundingClientRect();
        const menuWidth = menuRect.width || 184;
        const menuHeight = menuRect.height || 184;
        const left = Math.max(8, rect.left - menuWidth - 9);
        const top = Math.max(8, Math.min(rect.top - 2, window.innerHeight - menuHeight - 8));
        flyout.style.left = `${Math.round(left)}px`;
        flyout.style.top = `${Math.round(top)}px`;
        const arrowY = Math.max(16, Math.min(rect.top + rect.height / 2 - top, menuHeight - 16));
        flyout.style.setProperty("--retro-flyout-arrow-y", `${Math.round(arrowY)}px`);
      };
      const openFriendMenu = (friend) => {
        if (!flyout) return;
        if (activeFriend === friend && flyout.classList.contains("retro-friend-flyout-open")) {
          closeFriendMenu();
          return;
        }
        activeFriend?.classList.remove("retro-friend-menu-open");
        activeFriend?.setAttribute("aria-expanded", "false");
        for (const candidate of shell.querySelectorAll(".retro-friend")) {
          candidate.classList.toggle("retro-friend-selected", candidate === friend);
        }
        activeFriend = friend;
        friend.classList.add("retro-friend-menu-open");
        friend.setAttribute("aria-haspopup", "menu");
        friend.setAttribute("aria-expanded", "true");
        const name = friend.dataset.retroFriendName || friend.querySelector("b")?.textContent || "好友";
        const status = friend.dataset.retroFriendStatus || "";
        const nameNode = flyout.querySelector("[data-retro-flyout-name]");
        const statusNode = flyout.querySelector("[data-retro-flyout-status]");
        if (nameNode) nameNode.textContent = name;
        if (statusNode) statusNode.textContent = status;
        setMenuLabel("favorite", friend.classList.contains("retro-friend-favorite") ? "取消特别关心" : "设为特别关心");
        setMenuLabel("mute", friend.classList.contains("retro-friend-muted") ? "取消屏蔽此人" : "屏蔽此人");
        flyout.classList.add("retro-friend-flyout-open");
        flyout.setAttribute("aria-hidden", "false");
        positionFriendMenu(friend);
      };
      const showFriendToast = (message) => {
        if (!toast) return;
        if (toastTimer) clearTimeout(toastTimer);
        toast.textContent = message;
        toast.classList.add("retro-friend-toast-visible");
        toastTimer = setTimeout(() => toast.classList.remove("retro-friend-toast-visible"), 1800);
      };
      for (const friend of shell.querySelectorAll(".retro-friend")) {
        friend.setAttribute("aria-haspopup", "menu");
        friend.setAttribute("aria-expanded", "false");
        friend.addEventListener("click", () => openFriendMenu(friend));
        friend.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          openFriendMenu(friend);
        });
      }
      flyout?.addEventListener("click", (event) => {
        const button = event.target.closest("[data-retro-friend-command]");
        if (!button || !activeFriend) return;
        const name = activeFriend.dataset.retroFriendName || "好友";
        const command = button.dataset.retroFriendCommand;
        if (command === "favorite") {
          const enabled = activeFriend.classList.toggle("retro-friend-favorite");
          showFriendToast(enabled ? `已把「${name}」设为特别关心` : `已取消「${name}」的特别关心`);
        } else if (command === "mute") {
          const enabled = activeFriend.classList.toggle("retro-friend-muted");
          showFriendToast(enabled ? `已屏蔽「${name}」` : `已取消屏蔽「${name}」`);
        } else if (command === "profile") {
          showFriendToast(`正在查看「${name}」的资料`);
        } else {
          showFriendToast(`已选中与「${name}」聊天`);
        }
        closeFriendMenu();
      });
      document.addEventListener?.("pointerdown", (event) => {
        if (!flyout?.classList.contains("retro-friend-flyout-open")) return;
        if (flyout.contains(event.target) || event.target.closest?.(".retro-friend")) return;
        closeFriendMenu();
      }, { capture: true, signal: friendMenuAbort.signal });
      document.addEventListener?.("keydown", (event) => {
        if (event.key === "Escape" && flyout?.classList.contains("retro-friend-flyout-open")) {
          event.preventDefault();
          closeFriendMenu({ restoreFocus: true });
        }
      }, { signal: friendMenuAbort.signal });
      window.addEventListener?.("resize", () => closeFriendMenu(), { passive: true, signal: friendMenuAbort.signal });
      shell.querySelector(".retro-friend-list")?.addEventListener("scroll", () => closeFriendMenu(), { passive: true });
    }
    if (shell.__retroWheelAbort !== friendMenuAbort) {
      shell.__retroWheelAbort = friendMenuAbort;
      const leftScroll = shell.querySelector(".retro-left-scroll");
      const scheduleRetroTaskHitSync = () => {
        if (shell.__retroWheelSyncFrame) return;
        shell.__retroWheelSyncFrame = requestAnimationFrame(() => {
          shell.__retroWheelSyncFrame = 0;
          delete shell.dataset.retroTaskGeometry;
          const currentSidebar = document.querySelector("aside.app-shell-left-panel");
          if (currentSidebar) syncRetroSidebar(shell, currentSidebar);
        });
      };
      const retroLeftWheelForwarding = (event) => {
        if (!leftScroll || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
        const rect = leftScroll.getBoundingClientRect();
        if (!rect.width || !rect.height || event.clientX < rect.left || event.clientX > rect.right ||
            event.clientY < rect.top || event.clientY > rect.bottom) return;
        const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? leftScroll.clientHeight : 1;
        const delta = event.deltaY * unit;
        const maximum = Math.max(0, leftScroll.scrollHeight - leftScroll.clientHeight);
        const next = Math.max(0, Math.min(maximum, leftScroll.scrollTop + delta));
        if (!delta || next === leftScroll.scrollTop) return;
        leftScroll.scrollTop = next;
        scheduleRetroTaskHitSync();
        if (event.cancelable) event.preventDefault();
        event.stopPropagation();
      };
      leftScroll?.addEventListener("scroll", scheduleRetroTaskHitSync, {
        passive: true,
        signal: friendMenuAbort.signal,
      });
      document.addEventListener?.("wheel", retroLeftWheelForwarding, {
        capture: true,
        passive: false,
        signal: friendMenuAbort.signal,
      });
    }
    const clock = shell.querySelector("[data-retro-clock]");
    if (clock) {
      clock.textContent = new Intl.DateTimeFormat("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date());
    }
  };

  const cleanRetroText = (value) => String(value || "").replace(/\s+/g, " ").trim();

  const liveSidebarTasks = (sidebar) => {
    const seen = new Set();
    const tasks = [];
    for (const wrapper of sidebar.querySelectorAll('div.cursor-grab[role="button"]')) {
      const node = wrapper.querySelector('[role="button"]') || wrapper;
      const text = cleanRetroText(node.innerText);
      if (!text || seen.has(text)) continue;
      seen.add(text);
      tasks.push(node);
    }
    return tasks;
  };

  const liveSidebarAction = (sidebar, action, cachedButtons = null) => {
    const buttons = cachedButtons || [...sidebar.querySelectorAll('button,[role="button"]')];
    const exact = (text) => buttons
      .filter((node) => cleanRetroText(node.innerText) === text && node.getBoundingClientRect().width > 70)
      .sort((left, right) => right.getBoundingClientRect().width - left.getBoundingClientRect().width)[0];
    const aria = (label) => buttons.find((node) => node.getAttribute("aria-label") === label);
    return {
      mode: buttons.find((node) => node.getAttribute("aria-label")?.startsWith("切换模式")),
      new: exact("新建任务"),
      scheduled: exact("已安排"),
      plugin: exact("插件"),
      site: exact("站点"),
      pr: exact("拉取请求"),
      project: exact("项目"),
      chat: aria("Quick chat"),
      search: aria("搜索"),
      profile: aria("打开个人资料菜单"),
    }[action] || null;
  };

  const activateLiveControl = (target) => {
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const base = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      button: 0,
      clientX: rect.left + Math.min(18, rect.width / 2),
      clientY: rect.top + rect.height / 2,
    };
    try {
      target.dispatchEvent(new PointerEvent("pointerdown", {
        ...base, buttons: 1, pointerId: 1, pointerType: "mouse", isPrimary: true,
      }));
    } catch {}
    target.dispatchEvent(new MouseEvent("mousedown", { ...base, buttons: 1 }));
    try {
      target.dispatchEvent(new PointerEvent("pointerup", {
        ...base, buttons: 0, pointerId: 1, pointerType: "mouse", isPrimary: true,
      }));
    } catch {}
    target.dispatchEvent(new MouseEvent("mouseup", { ...base, buttons: 0 }));
    target.click();
  };

  const reactEventFor = (target) => ({
    button: 0,
    ctrlKey: false,
    defaultPrevented: false,
    currentTarget: target,
    target,
    nativeEvent: { button: 0, ctrlKey: false },
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() {},
  });

  const invokeReactHandler = (target, handlerName) => {
    if (!target) return false;
    const key = Object.keys(target).find((name) => name.startsWith("__reactProps$"));
    const handler = key ? target[key]?.[handlerName] : null;
    if (typeof handler !== "function") return false;
    handler(reactEventFor(target));
    return true;
  };

  const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

  const switchNativeMode = async (modeName) => {
    let sidebar = document.querySelector("aside.app-shell-left-panel");
    let trigger = sidebar && liveSidebarAction(sidebar, "mode");
    if (!trigger) return false;
    if (cleanRetroText(trigger.innerText) === modeName) return true;
    if (trigger.getAttribute("data-state") !== "open") {
      if (!invokeReactHandler(trigger, "onPointerDown")) return false;
      await delay(80);
    }
    const item = [...document.querySelectorAll('[role="menuitem"]')]
      .find((node) => cleanRetroText(node.innerText).startsWith(modeName));
    if (!item || !invokeReactHandler(item, "onClick")) return false;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await delay(60);
      sidebar = document.querySelector("aside.app-shell-left-panel");
      trigger = sidebar && liveSidebarAction(sidebar, "mode");
      if (cleanRetroText(trigger?.innerText) === modeName) return true;
    }
    return false;
  };

  const activateRetroSpecialAction = async (action) => {
    let sidebar = document.querySelector("aside.app-shell-left-panel");
    if (!sidebar) return;
    const modeName = cleanRetroText(liveSidebarAction(sidebar, "mode")?.innerText);
    if (action === "chat") {
      const target = liveSidebarAction(sidebar, modeName === "ChatGPT" ? "new" : "chat");
      if (!invokeReactHandler(target, "onClick")) activateLiveControl(target);
      return;
    }
    if (action !== "pr") return;
    let target = liveSidebarAction(sidebar, "pr");
    if (!target) {
      if (!await switchNativeMode("Codex")) return;
      await delay(500);
      for (let attempt = 0; attempt < 30 && !target; attempt += 1) {
        await delay(60);
        sidebar = document.querySelector("aside.app-shell-left-panel");
        target = sidebar && liveSidebarAction(sidebar, "pr");
      }
    }
    if (!invokeReactHandler(target, "onClick")) activateLiveControl(target);
  };

  const syncRetroSidebar = (shell, sidebar) => {
    const sidebarWidth = Math.round(sidebar.getBoundingClientRect().width);
    document.documentElement.style.setProperty(
      "--retro-left-live-width",
      `${sidebarWidth}px`,
    );
    const taskNodes = liveSidebarTasks(sidebar);
    const taskNames = taskNodes.map((node) => cleanRetroText(node.innerText));
    const list = shell.querySelector("[data-retro-task-list]");
    const signature = JSON.stringify(taskNames);
    const geometrySignature = `${signature}:${sidebarWidth}:${window.innerWidth}:${window.innerHeight}`;
    const taskListChanged = Boolean(list && list.dataset.signature !== signature);
    const previousTaskNodes = Array.isArray(shell.__retroTaskNodes) ? shell.__retroTaskNodes : [];
    const taskNodesReplaced = previousTaskNodes.length !== taskNodes.length ||
      taskNodes.some((node, index) => node !== previousTaskNodes[index]);
    shell.__retroTaskNodes = taskNodes;
    if (taskListChanged) {
      list.dataset.signature = signature;
      list.replaceChildren(...taskNames.slice(0, 8).map((name, index) => {
        const button = document.createElement("button");
        button.dataset.retroTaskIndex = String(index);
        const nativeTask = taskNodes[index];
        const completed = nativeTask?.getAttribute?.("data-state") === "completed" ||
          nativeTask?.querySelector?.('[data-state="checked"]');
        const taskState = completed ? "completed" : index === 0 ? "running" : "pending";
        button.className = `retro-task-note retro-task-${taskState}`;
        const icon = document.createElement("i");
        icon.className = `retro-task-icon retro-task-icon-${taskState}`;
        const copy = document.createElement("span");
        copy.className = "retro-task-copy";
        const label = document.createElement("span");
        label.className = "retro-task-label";
        label.textContent = name;
        copy.append(label);
        if (taskState === "running") {
          const status = document.createElement("small");
          status.textContent = "正在处理 · 点击继续";
          copy.append(status);
        }
        button.append(icon, copy);
        return button;
      }));
    }

    const taskHitBindingMissing = taskNodes.some((node) =>
      !node.classList.contains("retro-native-task-hit")
    );
    if (shell.dataset.retroTaskGeometry !== geometrySignature ||
        taskNodesReplaced || taskHitBindingMissing) {
      shell.dataset.retroTaskGeometry = geometrySignature;
      for (const previousTarget of document.querySelectorAll(".retro-native-task-hit")) {
        previousTarget.classList.remove("retro-native-task-hit");
        for (const property of [
          "--retro-native-task-x",
          "--retro-native-task-y",
          "--retro-native-task-width",
          "--retro-native-task-height",
        ]) previousTarget.style.removeProperty(property);
      }
      const customTaskButtons = list ? [...list.querySelectorAll("[data-retro-task-index]")] : [];
      taskNodes.forEach((target, index) => {
        const visibleButton = customTaskButtons[index];
        if (!visibleButton) return;
        const rect = visibleButton.getBoundingClientRect();
        const nativeRect = target.getBoundingClientRect();
        target.classList.add("retro-native-task-hit");
        target.style.setProperty("--retro-native-task-x", `${rect.left - nativeRect.left}px`);
        target.style.setProperty("--retro-native-task-y", `${rect.top - nativeRect.top}px`);
        target.style.setProperty("--retro-native-task-width", `${rect.width}px`);
        target.style.setProperty("--retro-native-task-height", `${rect.height}px`);
      });
    }

    const sidebarButtons = [...sidebar.querySelectorAll('button,[role="button"]')];
    const modeName = cleanRetroText(liveSidebarAction(sidebar, "mode", sidebarButtons)?.innerText) || "Codex";
    document.documentElement.classList.toggle("retro-chatgpt-mode", modeName === "ChatGPT");
    const modeLabel = shell.querySelector("[data-retro-mode-label]");
    if (modeLabel && modeLabel.textContent !== modeName) modeLabel.textContent = modeName;
    for (const action of ["new", "scheduled", "plugin", "site", "pr", "chat"]) {
      const visible = shell.querySelector(`.retro-left-nav [data-retro-action="${action}"]`);
      const native = liveSidebarAction(sidebar, action, sidebarButtons);
      const selected = native?.getAttribute?.("aria-current") === "page" ||
        native?.getAttribute?.("aria-selected") === "true" ||
        native?.getAttribute?.("aria-pressed") === "true" ||
        native?.getAttribute?.("data-state") === "active";
      visible?.classList.toggle("retro-shortcut-selected", Boolean(selected));
    }

    const detectedProfileName = cleanRetroText(liveSidebarAction(sidebar, "profile", sidebarButtons)?.innerText);
    if (detectedProfileName) shell.dataset.retroProfileCache = detectedProfileName;
    const profileName = detectedProfileName || shell.dataset.retroProfileCache || "Codex 用户";
    const profileLabel = shell.querySelector("[data-retro-profile-name]");
    if (profileLabel && profileLabel.textContent !== profileName) profileLabel.textContent = profileName;

    const mainTitle = shell.querySelector("[data-retro-main-title]");
    const settingsOpen = Boolean(sidebar.querySelector('nav[aria-label="设置"]'));
    const resolvedTitle = settingsOpen ? "Codex 设置" : taskNames[0] || "Codex 任务";
    if (mainTitle && mainTitle.textContent !== resolvedTitle) mainTitle.textContent = resolvedTitle;

    if (shell.dataset.retroSidebarWired !== "true") {
      shell.dataset.retroSidebarWired = "true";
      shell.addEventListener("click", (event) => {
        const sectionToggle = event.target.closest?.("[data-retro-section-toggle]");
        if (sectionToggle) {
          event.preventDefault();
          event.stopPropagation();
          const section = sectionToggle.dataset.retroSectionToggle;
          const body = shell.querySelector(`[data-retro-section-body="${section}"]`);
          if (!body) return;
          const collapsed = body.classList.toggle("retro-section-collapsed");
          sectionToggle.textContent = collapsed ? "⌄" : "⌃";
          sectionToggle.setAttribute("aria-expanded", String(!collapsed));
          delete shell.dataset.retroTaskGeometry;
          setTimeout(() => {
            const currentSidebar = document.querySelector("aside.app-shell-left-panel");
            if (currentSidebar) syncRetroSidebar(shell, currentSidebar);
          }, 190);
          return;
        }
        const control = event.target.closest?.("[data-retro-action],[data-retro-task-index]");
        if (!control) return;
        event.preventDefault();
        event.stopPropagation();
        const currentSidebar = document.querySelector("aside.app-shell-left-panel");
        if (!currentSidebar) return;
        const action = control.dataset.retroAction;
        if (action === "pr" || action === "chat") {
          void activateRetroSpecialAction(action);
          return;
        }
        const taskIndex = Number(control.dataset.retroTaskIndex);
        const target = Number.isInteger(taskIndex) && control.dataset.retroTaskIndex !== undefined
          ? liveSidebarTasks(currentSidebar)[taskIndex]
          : liveSidebarAction(currentSidebar, action);
        activateLiveControl(target);
      });
    }
  };

  const syncRetroConversation = (main) => {
    const users = new Set();
    const assistants = new Set();
    for (const content of main.querySelectorAll('[class*="_markdownContent_"]')) {
      const userBubble = content.closest('[class~="bg-token-foreground/5"][class~="rounded-2xl"]');
      if (userBubble) {
        users.add(userBubble);
        continue;
      }
      const assistantBubble = content.closest(".group.flex.min-w-0.flex-col") || content.parentElement;
      if (assistantBubble && main.contains(assistantBubble)) assistants.add(assistantBubble);
    }
    for (const node of main.querySelectorAll(".retro-user-bubble")) {
      if (!users.has(node)) {
        node.classList.remove("retro-user-bubble");
        node.querySelector(":scope > .retro-bubble-avatar-user")?.remove();
      }
    }
    for (const node of main.querySelectorAll(".retro-assistant-bubble")) {
      if (!assistants.has(node)) {
        node.classList.remove("retro-assistant-bubble");
        node.querySelector(":scope > .retro-bubble-avatar-assistant")?.remove();
      }
    }
    for (const node of users) {
      node.classList.add("retro-user-bubble");
      if (!node.querySelector(":scope > .retro-bubble-avatar")) {
        const avatar = document.createElement("i");
        avatar.className = "retro-bubble-avatar retro-bubble-avatar-user";
        avatar.setAttribute("aria-hidden", "true");
        node.appendChild(avatar);
      }
    }
    for (const node of assistants) {
      node.classList.add("retro-assistant-bubble");
      if (!node.querySelector(":scope > .retro-bubble-avatar")) {
        const avatar = document.createElement("i");
        avatar.className = "retro-bubble-avatar retro-bubble-avatar-assistant candy-sprout";
        avatar.setAttribute("aria-hidden", "true");
        node.appendChild(avatar);
      }
    }
  };

  const ensure = () => {
    if (window.__CODEX_DREAM_SKIN_DISABLED__) return;
    const root = document.documentElement;
    if (!root || !document.body) return;

    const shellMain = document.querySelector("main.main-surface");
    const shellSidebar = document.querySelector("aside.app-shell-left-panel");
    if (!shellMain || !shellSidebar) {
      clearSkinDom();
      return;
    }

    root.classList.add("codex-dream-skin");
    applyProfile(root);

    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      (document.head || root).appendChild(style);
    }
    if (style.dataset.dreamVersion !== "3") {
      style.textContent = cssText;
      style.dataset.dreamVersion = "3";
    }

    const home = document.querySelector('[role="main"]:has([data-testid="home-icon"])');
    for (const candidate of document.querySelectorAll('[role="main"]')) {
      candidate.classList.toggle("dream-home", candidate === home);
      candidate.classList.toggle("dream-task", candidate !== home);
    }
    const utilityBars = new Set(home ? home.querySelectorAll('[class*="_homeUtilityBar_"]') : []);
    for (const candidate of document.querySelectorAll(`.${HOME_UTILITY_CLASS}`)) {
      if (!utilityBars.has(candidate)) candidate.classList.remove(HOME_UTILITY_CLASS);
    }
    for (const candidate of utilityBars) candidate.classList.add(HOME_UTILITY_CLASS);
    shellMain.classList.toggle("dream-home-shell", Boolean(home));

    let chrome = document.getElementById(CHROME_ID);
    if (!chrome || chrome.parentElement !== document.body) {
      chrome?.remove();
      chrome = document.createElement("div");
      chrome.id = CHROME_ID;
      chrome.setAttribute("aria-hidden", "true");
      document.body.appendChild(chrome);
    }
    chrome.classList.toggle("dream-home-shell", Boolean(home));
    ensureRetroChrome(chrome);
    const retroShell = chrome.querySelector(".candy-shell");
    if (retroShell) syncRetroSidebar(retroShell, shellSidebar);
    syncRetroConversation(shellMain);
  };

  const syncSkinScopes = ({ sidebar = false, conversation = false } = {}) => {
    if (window.__CODEX_DREAM_SKIN_DISABLED__) return;
    const shellMain = document.querySelector("main.main-surface");
    const shellSidebar = document.querySelector("aside.app-shell-left-panel");
    const retroShell = document.getElementById(CHROME_ID)?.querySelector(".candy-shell");
    if (!shellMain || !shellSidebar || !retroShell) {
      ensure();
      return;
    }
    if (sidebar) syncRetroSidebar(retroShell, shellSidebar);
    if (conversation) syncRetroConversation(shellMain);
  };

  const cleanup = () => {
    const state = window[STATE_KEY];
    if (state?.installToken !== installToken) return false;
    window.__CODEX_DREAM_SKIN_DISABLED__ = true;
    clearSkinDom();
    state?.observer?.disconnect();
    if (state?.timer) clearInterval(state.timer);
    if (state?.scheduler?.timeout) clearTimeout(state.scheduler.timeout);
    if (state?.onResize) window.removeEventListener?.("resize", state.onResize);
    state?.friendMenuAbort?.abort();
    if (state?.artUrl) URL.revokeObjectURL(state.artUrl);
    delete window[STATE_KEY];
    return true;
  };

  const scheduler = { timeout: null, full: false, sidebar: false, conversation: false };
  const scheduleEnsure = (scope = "full") => {
    if (scope === "full") scheduler.full = true;
    else if (scope === "sidebar") scheduler.sidebar = true;
    else if (scope === "conversation") scheduler.conversation = true;
    if (scheduler.timeout) return;
    scheduler.timeout = setTimeout(() => {
      scheduler.timeout = null;
      const full = scheduler.full;
      const sidebar = scheduler.sidebar;
      const conversation = scheduler.conversation;
      scheduler.full = false;
      scheduler.sidebar = false;
      scheduler.conversation = false;
      if (full) ensure();
      else syncSkinScopes({ sidebar, conversation });
    }, 120);
  };

  const mutationTouchesStructure = (record) => {
    const nodes = [...(record.addedNodes || []), ...(record.removedNodes || [])];
    return nodes.some((node) => node?.nodeType === 1 && (
      node.matches?.("main.main-surface,aside.app-shell-left-panel,[role='main'],[data-testid='home-icon']") ||
      node.querySelector?.("main.main-surface,aside.app-shell-left-panel,[role='main'],[data-testid='home-icon']")
    ));
  };
  const containsMutationTarget = (container, target) => Boolean(
    container && target && (container === target || container.contains?.(target))
  );

  observer = new MutationObserver((records) => {
    if (samplingNativeShell) return;
    const root = document.documentElement;
    const shellMain = document.querySelector("main.main-surface");
    const shellSidebar = document.querySelector("aside.app-shell-left-panel");
    const chrome = document.getElementById(CHROME_ID);
    let full = false;
    let sidebar = false;
    let conversation = false;
    for (const record of records) {
      if (record.target === root || mutationTouchesStructure(record)) {
        full = true;
        break;
      }
      if (containsMutationTarget(chrome, record.target)) continue;
      if (containsMutationTarget(shellSidebar, record.target)) sidebar = true;
      else if (containsMutationTarget(shellMain, record.target)) conversation = true;
    }
    if (full) scheduleEnsure("full");
    else {
      if (sidebar) scheduleEnsure("sidebar");
      if (conversation) scheduleEnsure("conversation");
    }
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "data-theme", "data-appearance", "data-color-mode"],
  });
  const timer = setInterval(ensure, 30000);
  const onResize = () => scheduleEnsure("sidebar");
  window.addEventListener?.("resize", onResize, { passive: true });
  window[STATE_KEY] = {
    ensure, sync: syncSkinScopes, cleanup, observer, timer, scheduler, onResize,
    artUrl, profile, config, installToken, friendMenuAbort, version: "1.2.0",
  };
  ensure();
  analyzeArt().then((result) => {
    const state = window[STATE_KEY];
    if (state?.installToken !== installToken || window.__CODEX_DREAM_SKIN_DISABLED__) return;
    profile = result;
    state.profile = result;
    ensure();
  });
  return { installed: true, version: "1.2.0", adaptive: true };
})(__DREAM_CSS_JSON__, __DREAM_ART_JSON__, __DREAM_THEME_JSON__)
