// ============================================================
// SAM ARCHIVE 게시물 올리기 — GitHub 저장소에 직접 커밋하는 관리자 도구.
// archive.md는 호수→유형처럼 고정된 형식이 아니라 자유로운 중첩 불릿이므로,
// 이 도구도 "1단계/2단계 항목"을 실제 archive.md에서 읽어와 동적으로 보여준다.
// ============================================================

const OWNER = 'jchinseoul';
const REPO = 'sam-archive';
const BRANCH = 'main';
const TOKEN_STORAGE_KEY = 'sam_archive_admin_token';
const NEW_OPTION = '__new__';

const els = {
  token: document.getElementById('token'),
  rememberToken: document.getElementById('rememberToken'),
  level1Select: document.getElementById('level1Select'),
  level1NewWrap: document.getElementById('level1NewWrap'),
  level1New: document.getElementById('level1New'),
  level2Select: document.getElementById('level2Select'),
  level2NewWrap: document.getElementById('level2NewWrap'),
  level2New: document.getElementById('level2New'),
  title: document.getElementById('title'),
  imageFile: document.getElementById('imageFile'),
  videoFile: document.getElementById('videoFile'),
  videoUrl: document.getElementById('videoUrl'),
  sizeWarning: document.getElementById('sizeWarning'),
  bodyText: document.getElementById('bodyText'),
  form: document.getElementById('postForm'),
  submitBtn: document.getElementById('submitBtn'),
  status: document.getElementById('status'),
};

// GitHub Contents API는 파일 하나당 사실상 100MB가 한계이고, 그보다 훨씬 작아도
// 저장소가 무거워지므로 이 이상이면 경고만 보여준다(업로드 자체는 막지 않음).
const VIDEO_WARN_BYTES = 15 * 1024 * 1024; // 15MB

els.videoFile.addEventListener('change', () => {
  const file = els.videoFile.files[0];
  if (!file) { els.sizeWarning.style.display = 'none'; return; }
  if (file.size > VIDEO_WARN_BYTES) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    els.sizeWarning.textContent = `⚠️ 이 영상은 ${mb}MB입니다. GitHub 저장소에 큰 파일을 계속 올리면 저장소가 무거워질 수 있어요. 그래도 업로드는 진행됩니다.`;
    els.sizeWarning.style.display = 'block';
  } else {
    els.sizeWarning.style.display = 'none';
  }
});

// ---------- GitHub API 헬퍼 ----------
function ghHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
  };
}

async function ghGetFile(path, token) {
  const res = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/contents/${encodeURIComponent(path)}?ref=${BRANCH}`,
    { headers: ghHeaders(token) },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET ${path} 실패 (${res.status})`);
  return res.json(); // { content(base64, 줄바꿈 포함), sha }
}

async function ghPutText(path, token, text, message, sha) {
  const body = { message, content: b64EncodeUtf8(text), branch: BRANCH };
  if (sha) body.sha = sha;
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${encodeURIComponent(path)}`, {
    method: 'PUT',
    headers: { ...ghHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} 저장 실패 (${res.status}): ${await res.text()}`);
  return res.json();
}

async function ghPutBinaryBase64(path, token, base64Content, message) {
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${encodeURIComponent(path)}`, {
    method: 'PUT',
    headers: { ...ghHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, content: base64Content, branch: BRANCH }),
  });
  if (!res.ok) throw new Error(`${path} 업로드 실패 (${res.status}): ${await res.text()}`);
  return res.json();
}

function b64EncodeUtf8(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

function b64DecodeUtf8(b64) {
  const binary = atob(b64.replace(/\n/g, ''));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ---------- archive.md 파싱 (호수/유형 같은 고정 이름 없이, 들여쓰기만으로 계층 판단) ----------
function stripDecoration(s) {
  return s.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}]/gu, '').trim();
}

function indentOf(line) {
  const m = line.match(/^(\s*)-/);
  return m ? m[1].length : null;
}

// { level1이름: [level2이름, ...] } 형태로, 실제 archive.md에 있는 1단계/2단계 항목만 뽑는다.
function parseLevels(mdText) {
  const lines = mdText.split('\n');
  const map = new Map(); // name -> Set(level2 names)
  let currentLevel1 = null;

  for (const line of lines) {
    if (!line.trim()) continue;
    const ind = indentOf(line);
    if (ind === null) continue;
    const m = line.match(/^\s*-\s+(.*)$/);
    if (!m) continue;
    const text = m[1].trim();

    if (ind === 0) {
      currentLevel1 = text;
      if (!map.has(currentLevel1)) map.set(currentLevel1, []);
    } else if (ind === 2 && currentLevel1) {
      map.get(currentLevel1).push(text);
    }
  }
  return map;
}

function findBlockEnd(lines, startIdx, indent) {
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const ind = indentOf(lines[i]);
    if (ind !== null && ind <= indent) return i;
  }
  return lines.length;
}

function insertPost(mdText, { level1, level2, leafLine }) {
  const lines = mdText.split('\n');

  let level1Idx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (indentOf(lines[i]) === 0) {
      const m = lines[i].match(/^-\s+(.*)$/);
      if (m && stripDecoration(m[1]) === stripDecoration(level1)) { level1Idx = i; break; }
    }
  }

  if (level1Idx === -1) {
    if (lines[lines.length - 1] !== undefined && lines[lines.length - 1].trim() !== '') lines.push('');
    lines.push(`- ${level1}`);
    lines.push(`  - ${level2}`);
    lines.push(`    ${leafLine}`);
    return lines.join('\n');
  }

  const level1End = findBlockEnd(lines, level1Idx, 0);
  let level2Idx = -1;
  for (let i = level1Idx + 1; i < level1End; i++) {
    if (!lines[i].trim()) continue;
    if (indentOf(lines[i]) === 2) {
      const m = lines[i].match(/^\s*-\s+(.*)$/);
      if (m && stripDecoration(m[1]) === stripDecoration(level2)) { level2Idx = i; break; }
    }
  }

  if (level2Idx === -1) {
    lines.splice(level1End, 0, `  - ${level2}`, `    ${leafLine}`);
    return lines.join('\n');
  }

  const level2End = findBlockEnd(lines, level2Idx, 2);
  lines.splice(level2End, 0, `    ${leafLine}`);
  return lines.join('\n');
}

// ---------- 파일명 생성 ----------
function timestampSlug() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${Math.random().toString(36).slice(2, 7)}`;
}

// ---------- 상태 표시 ----------
function setStatus(msg, kind) {
  els.status.textContent = msg;
  els.status.className = kind || '';
}

// ---------- 드롭다운 채우기 ----------
let levelMap = new Map();

function fillSelectWithNewOption(select, names, keepValue) {
  select.innerHTML = '';
  names.forEach((name) => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    select.append(opt);
  });
  const newOpt = document.createElement('option');
  newOpt.value = NEW_OPTION;
  newOpt.textContent = '+ 새로 추가';
  select.append(newOpt);
  if (keepValue && names.includes(keepValue)) select.value = keepValue;
  else select.value = names.length ? names[0] : NEW_OPTION;
}

function updateLevel1NewVisibility() {
  els.level1NewWrap.hidden = els.level1Select.value !== NEW_OPTION;
}

function updateLevel2Options() {
  const level1 = els.level1Select.value;
  const level2Names = level1 !== NEW_OPTION && levelMap.has(level1) ? levelMap.get(level1) : [];
  fillSelectWithNewOption(els.level2Select, [...new Set(level2Names)]);
  els.level2NewWrap.hidden = els.level2Select.value !== NEW_OPTION;
}

async function refreshLevels() {
  const token = els.token.value.trim();
  if (!token) {
    levelMap = new Map();
    fillSelectWithNewOption(els.level1Select, []);
    updateLevel1NewVisibility();
    updateLevel2Options();
    return;
  }
  const file = await ghGetFile('archive.md', token);
  levelMap = file ? parseLevels(b64DecodeUtf8(file.content)) : new Map();
  const prevLevel1 = els.level1Select.value;
  fillSelectWithNewOption(els.level1Select, [...levelMap.keys()], prevLevel1);
  updateLevel1NewVisibility();
  updateLevel2Options();
}

els.level1Select.addEventListener('change', () => {
  updateLevel1NewVisibility();
  updateLevel2Options();
});
els.level2Select.addEventListener('change', () => {
  els.level2NewWrap.hidden = els.level2Select.value !== NEW_OPTION;
});
els.token.addEventListener('change', () => {
  refreshLevels().catch((e) => setStatus(`항목 목록을 불러오지 못했습니다: ${e.message}`, 'error'));
});

(function init() {
  const saved = localStorage.getItem(TOKEN_STORAGE_KEY);
  if (saved) els.token.value = saved;
  refreshLevels().catch(() => {
    // 토큰이 아직 없거나 실패해도 폼 자체는 계속 쓸 수 있게 조용히 무시
  });
})();

// ---------- 제출 ----------
els.form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const token = els.token.value.trim();
  if (!token) { setStatus('GitHub 토큰을 입력해주세요.', 'error'); return; }

  const level1 = els.level1Select.value === NEW_OPTION ? els.level1New.value.trim() : els.level1Select.value;
  const level2 = els.level2Select.value === NEW_OPTION ? els.level2New.value.trim() : els.level2Select.value;
  const title = els.title.value.trim();
  const imageFile = els.imageFile.files[0];
  const videoFile = els.videoFile.files[0];
  const videoUrl = els.videoUrl.value.trim();
  const bodyText = els.bodyText.value.trim();

  if (!level1) { setStatus('1단계 항목 이름을 입력해주세요.', 'error'); return; }
  if (!level2) { setStatus('2단계 항목 이름을 입력해주세요.', 'error'); return; }
  if (!title) { setStatus('제목을 입력해주세요.', 'error'); return; }

  els.submitBtn.disabled = true;
  setStatus('업로드 중...');

  try {
    if (els.rememberToken.checked) {
      localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    }

    // 여러 개를 채웠다면 영상 링크 → 영상 파일 → 이미지 → 글 순서로 하나만 사용한다.
    let linkTarget = null;

    if (videoUrl) {
      linkTarget = videoUrl;
    } else if (videoFile) {
      const ext = (videoFile.name.split('.').pop() || 'mp4').toLowerCase();
      linkTarget = `assets/video-${timestampSlug()}.${ext}`;
      setStatus('영상 업로드 중... (용량에 따라 시간이 걸릴 수 있습니다)');
      const base64 = await fileToBase64(videoFile);
      await ghPutBinaryBase64(linkTarget, token, base64, `Add video for "${title}"`);
    } else if (imageFile) {
      const ext = (imageFile.name.split('.').pop() || 'jpg').toLowerCase();
      linkTarget = `assets/img-${timestampSlug()}.${ext}`;
      setStatus('이미지 업로드 중...');
      const base64 = await fileToBase64(imageFile);
      await ghPutBinaryBase64(linkTarget, token, base64, `Add image for "${title}"`);
    } else if (bodyText) {
      linkTarget = `assets/post-${timestampSlug()}.txt`;
      setStatus('글 파일 업로드 중...');
      await ghPutText(linkTarget, token, bodyText, `Add post text for "${title}"`);
    }

    setStatus('archive.md 갱신 중...');
    const current = await ghGetFile('archive.md', token);
    if (!current) throw new Error('archive.md 파일을 찾을 수 없습니다.');
    const currentText = b64DecodeUtf8(current.content);
    const leafLine = linkTarget ? `- [${title}](${linkTarget})` : `- ${title}`;
    const updatedText = insertPost(currentText, { level1, level2, leafLine });

    await ghPutText('archive.md', token, updatedText, `Add "${title}" under ${level1} / ${level2}`, current.sha);

    setStatus(`완료! "${level1} > ${level2} > ${title}" 게시물이 추가됐습니다.\n1분 정도 후 사이트에 반영됩니다.`, 'ok');

    els.title.value = '';
    els.imageFile.value = '';
    els.videoFile.value = '';
    els.videoUrl.value = '';
    els.sizeWarning.style.display = 'none';
    els.bodyText.value = '';
    els.level1New.value = '';
    els.level2New.value = '';
    await refreshLevels();
    if ([...els.level1Select.options].some((o) => o.value === level1)) {
      els.level1Select.value = level1;
      updateLevel2Options();
      if ([...els.level2Select.options].some((o) => o.value === level2)) els.level2Select.value = level2;
    }
  } catch (err) {
    setStatus(`오류: ${err.message}`, 'error');
  } finally {
    els.submitBtn.disabled = false;
  }
});
