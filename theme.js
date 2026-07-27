// 다크 모드 / 라이트 모드 수동 전환. 기본은 시스템(브라우저) 설정을 따르고,
// 사용자가 버튼을 누르면 그 뒤로는 이 브라우저에서 고른 값을 기억한다.
(function () {
  const KEY = 'sam_archive_theme'; // 'light' | 'dark' | 저장값 없음(=시스템 설정 따름)
  const lightQuery = window.matchMedia('(prefers-color-scheme: light)');

  function storedTheme() {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  }

  // 지금 실제로 적용돼야 하는 테마(수동 설정이 있으면 그것, 없으면 시스템 설정).
  function effectiveTheme() {
    return storedTheme() || (lightQuery.matches ? 'light' : 'dark');
  }

  function applyAttribute() {
    const stored = storedTheme();
    if (stored) document.documentElement.setAttribute('data-theme', stored);
    else document.documentElement.removeAttribute('data-theme');
  }

  // 로고 이미지(헤더 <img class="logo">, 마인드맵 중심 <image class="root-logo">)를
  // 지금 테마에 맞는 파일로 바꾼다.
  function updateLogos() {
    const href = effectiveTheme() === 'light' ? 'logo-light.png' : 'logo.png';
    document.querySelectorAll('img.logo').forEach((img) => {
      img.src = href;
    });
    document.querySelectorAll('image.root-logo').forEach((img) => {
      img.setAttribute('href', href);
    });
  }

  function renderToggleButton(btn) {
    const light = effectiveTheme() === 'light';
    btn.textContent = light ? '🌙' : '☀️';
    btn.setAttribute('aria-label', light ? '다크 모드로 전환' : '라이트 모드로 전환');
  }

  applyAttribute();

  window.samTheme = { effectiveTheme, updateLogos };

  document.addEventListener('DOMContentLoaded', () => {
    updateLogos();
    const btn = document.getElementById('themeToggle');
    if (btn) {
      renderToggleButton(btn);
      btn.addEventListener('click', () => {
        const next = effectiveTheme() === 'light' ? 'dark' : 'light';
        try {
          localStorage.setItem(KEY, next);
        } catch {
          // 저장이 안 되도(사파리 프라이빗 모드 등) 이번 페이지에서는 그대로 적용한다.
        }
        applyAttribute();
        renderToggleButton(btn);
        updateLogos();
      });
    }
  });

  // 수동 설정이 없을 때만(=시스템 설정을 따르는 중일 때만) 시스템 테마 변경에 반응한다.
  lightQuery.addEventListener('change', () => {
    if (!storedTheme()) updateLogos();
  });
})();
