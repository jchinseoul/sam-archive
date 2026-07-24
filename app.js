// ============================================================
// 문학회 매거진 아카이브 — 중심에서 왼쪽·오른쪽·아래로 펼쳐지는 부채꼴 마인드맵
// markmap 대신 d3.hierarchy + d3.tree(방사형)를 직접 사용합니다.
// 앞으로 이 파일은 다시 건드릴 필요가 없습니다. (수정 대상은 archive.md만)
// ============================================================

(async () => {
  // ---------- 0. 설정값 ----------
  const RADIUS = 11;                 // 원 크기 (더 크게)
  const NODE_DY = 170;                // 부모-자식 간 반지름 간격 (깊이 방향)
  const COLOR_TOP = '#3f7d4f';        // 맨 위(뿌리/호수) — 초록 계열
  const COLOR_BOTTOM = '#7a4a25';     // 맨 아래(게시물 리프) — 갈색 계열
  const MAX_DEPTH = 3;                // 호수(1) → 유형(2) → 게시물(3)
  const INITIAL_VISIBLE_DEPTH = 0;    // 처음엔 중심 글자(루트)만 보여주고, 클릭하면 가지가 뻗어나옴

  const colorScale = d3.interpolateRgb(COLOR_TOP, COLOR_BOTTOM);
  const colorOf = (d) => colorScale(Math.min(d.depth / MAX_DEPTH, 1));

  // ---------- 1. archive.md → 계층 데이터 파싱 ----------
  const res = await fetch('archive.md', { cache: 'no-store' });
  const markdown = await res.text();

  function parseMarkdown(md) {
    const lines = md.split('\n');
    const rootLine = lines.find((l) => l.trim().startsWith('#'));
    const rootName = rootLine ? rootLine.replace(/^#+\s*/, '').trim() : '아카이브';

    const root = { name: rootName, url: null, children: [] };
    const stack = [{ node: root, indent: -1 }];
    const linkRe = /^\[(.+)\]\((.+)\)$/;

    for (const raw of lines) {
      const m = raw.match(/^(\s*)-\s+(.*)$/);
      if (!m) continue;
      const indent = m[1].replace(/\t/g, '  ').length;
      const level = Math.floor(indent / 2);
      const content = m[2].trim();

      let name = content;
      let url = null;
      const linkMatch = content.match(linkRe);
      if (linkMatch) {
        name = linkMatch[1];
        url = linkMatch[2];
      }

      const node = { name, url, children: [] };

      while (stack.length && stack[stack.length - 1].indent >= level) {
        stack.pop();
      }
      stack[stack.length - 1].node.children.push(node);
      stack.push({ node, indent: level });
    }
    return root;
  }

  const data = parseMarkdown(markdown);

  // ---------- 2. d3 계층 + 트리 레이아웃 (부채꼴: 오른쪽→아래→왼쪽으로 반원 펼침) ----------
  const root = d3.hierarchy(data);
  // 각도(x)만 0~PI로 배분받고, 반지름(y)은 아래에서 depth 기준으로 직접 계산한다.
  const treeLayout = d3.tree().size([Math.PI, 1]);

  // 접기 전에 "원래 하위 트리 크기"를 노드마다 미리 저장해둔다 (자기 자신 포함).
  // 나중에 접혔다 펼쳐졌다 해도 이 값은 안 바뀌어야 하므로 collapseBeyond보다 먼저 계산.
  root.each((d) => { d.__fullSize = d.descendants().length; });

  // 처음엔 INITIAL_VISIBLE_DEPTH보다 깊은 노드는 접어둠
  function collapseBeyond(node, depth) {
    if (!node.children) return;
    if (depth >= INITIAL_VISIBLE_DEPTH) {
      node._children = node.children;
      node._children.forEach((c) => collapseBeyond(c, depth + 1));
      node.children = null;
    } else {
      node.children.forEach((c) => collapseBeyond(c, depth + 1));
    }
  }
  collapseBeyond(root, 0);

  // ---------- 3. SVG / 줌·팬 준비 ----------
  const svg = d3.select('#tree');
  const g = svg.append('g');

  const zoomBehavior = d3.zoom()
    .scaleExtent([0.3, 3])
    .on('zoom', (event) => g.attr('transform', event.transform));
  svg.call(zoomBehavior);

  function fit() {
    const bounds = g.node().getBBox();
    const svgRect = svg.node().getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) return;

    const padding = 60;
    const scale = Math.min(
      (svgRect.width - padding) / bounds.width,
      (svgRect.height - padding) / bounds.height,
      1.4
    );
    const tx = svgRect.width / 2 - scale * (bounds.x + bounds.width / 2);
    const ty = 50 - scale * bounds.y; // 뿌리를 상단 근처에 고정

    svg.transition().duration(400).call(
      zoomBehavior.transform,
      d3.zoomIdentity.translate(tx, ty).scale(scale)
    );
  }

  // ---------- 4. 렌더링 ----------
  // 극좌표(d.x=각도, d.y=반지름) → 화면 좌표 변환. 각도는 오른쪽(π/2)에서
  // 시작해 아래(π)를 지나 왼쪽(3π/2)까지, 위쪽으로는 절대 뻗지 않는 반원.
  const cartesianX = (d) => d.y * Math.sin(d.x);
  const cartesianY = (d) => -d.y * Math.cos(d.x);
  const nodeTransform = (d) => `translate(${cartesianX(d)},${cartesianY(d)})`;
  const radialLink = d3.linkRadial().angle((d) => d.x).radius((d) => d.y);

  // 노드마다 항상 같은 값이 나오는 의사난수(0~1) — 매번 다시 그려도 흔들리지 않으면서
  // 가지 길이·각도가 자연스럽게 들쭉날쭉해 보이게 만드는 용도.
  function hash01(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return ((h >>> 0) % 10000) / 10000;
  }
  const ANGLE_JITTER = 0.16;      // 라디안, 약 ±9도
  const RADIUS_JITTER = 0.22;     // NODE_DY 대비 비율, 약 ±22%

  // "연관도"의 대리 지표: 이 노드의 하위 트리가 부모의 하위 트리에서 차지하는
  // 비중. 부모 아래 콘텐츠의 큰 부분을 차지할수록(=구조적으로 강하게 연결될수록)
  // 연관도가 높다고 보고 가지를 짧게, 부모 대비 비중이 작은(곁가지성) 항목은
  // 가지를 길게 만든다. __fullSize는 접기 전에 미리 계산해둔 값이라 펼침 상태와
  // 무관하게 항상 같다.
  function relevance(d) {
    if (!d.parent) return 0;
    return Math.min(1, d.__fullSize / d.parent.__fullSize);
  }
  const RELEVANCE_SHRINK = 0.45; // 연관도가 1일 때 반지름을 최대 45%까지 줄임

  function update() {
    treeLayout(root);
    root.each((d) => {
      const key = d.data.name + '-' + d.depth + '-' + (d.parent ? d.parent.data.name : '');
      const angleJitter = d.depth === 0 ? 0 : (hash01(key) - 0.5) * ANGLE_JITTER;
      const radiusJitter = d.depth === 0 ? 0 : (hash01(key + '#r') - 0.5) * NODE_DY * RADIUS_JITTER;
      const rel = relevance(d);
      const baseRadius = d.depth * NODE_DY * (1 - rel * RELEVANCE_SHRINK);
      d.x = d.x + Math.PI / 2 + angleJitter; // [0, π] → [π/2, 3π/2] (오른쪽 → 아래 → 왼쪽) + 미세한 각도 흔들림
      d.y = d.depth === 0 ? 0 : Math.max(baseRadius + radiusJitter, NODE_DY * 0.4); // 연관도가 높을수록 가지가 짧아짐
    });

    const nodes = root.descendants();
    const links = root.links();

    // 가지(선)
    g.selectAll('path.link')
      .data(links, (d) => d.target.data.name + '-' + d.target.depth + '-' + (d.target.parent ? d.target.parent.data.name : ''))
      .join(
        (enter) => enter.append('path')
          .attr('class', 'link')
          .attr('stroke', (d) => colorOf(d.target))
          .attr('d', radialLink),
        (update) => update
          .attr('stroke', (d) => colorOf(d.target))
          .attr('d', radialLink),
        (exit) => exit.remove()
      );

    // 노드(텍스트만)
    const node = g.selectAll('g.node')
      .data(nodes, (d) => d.data.name + '-' + d.depth + '-' + (d.parent ? d.parent.data.name : ''));

    const nodeEnter = node.enter().append('g')
      .attr('class', 'node')
      .attr('transform', nodeTransform)
      .style('cursor', 'pointer')
      .on('click', (_event, d) => {
        if (d.data.url) {
          window.open(d.data.url, '_blank', 'noopener');
          return;
        }
        if (d.children) {
          d._children = d.children;
          d.children = null;
        } else if (d._children) {
          d.children = d._children;
          d._children = null;
        }
        update();
        fit();
      });

    nodeEnter.append('text')
      .attr('class', 'node-label')
      .attr('dy', '-1.1em')
      .attr('text-anchor', 'middle')
      .text((d) => d.data.name);

    node.merge(nodeEnter)
      .attr('transform', nodeTransform);

    node.select('text').text((d) => d.data.name);

    node.exit().remove();
  }

  update();
  requestAnimationFrame(fit);
  window.addEventListener('resize', fit);
  document.getElementById('fitBtn').addEventListener('click', fit);

  // ---------- 5. 리스트 보기 토글 (모바일 등 트리 조작이 불편할 때 대안) ----------
  function renderListHTML(node) {
    if (!node.children || node.children.length === 0) {
      return node.url
        ? `<li><a href="${node.url}" target="_blank" rel="noopener">${node.name}</a></li>`
        : `<li>${node.name}</li>`;
    }
    const items = node.children.map(renderListHTML).join('');
    return `<details open><summary>${node.name}</summary><ul>${items}</ul></details>`;
  }

  const listView = document.getElementById('listView');
  listView.innerHTML = `<ul>${(data.children || []).map(renderListHTML).join('')}</ul>`;

  const treeEl = document.getElementById('tree');
  const listToggle = document.getElementById('listToggle');
  let showingList = false;
  listToggle.addEventListener('click', () => {
    showingList = !showingList;
    // SVG 요소는 hidden 프로퍼티가 속성으로 반영되지 않아 style.display로 직접 제어
    treeEl.style.display = showingList ? 'none' : '';
    listView.hidden = !showingList;
    listToggle.textContent = showingList ? '마인드맵으로 보기' : '리스트로 보기';
  });
})();