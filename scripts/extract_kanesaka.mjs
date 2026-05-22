// TAAM 본 앱의 카네사카 계보 SVG 데이터를 lineage-builder JSON 으로 변환.
// 사용: node scripts/extract_kanesaka.mjs
//   입력: C:/TAAM/index.html
//   출력: samples/kanesaka.json

import fs from 'node:fs';
import path from 'node:path';

const SRC = 'C:/TAAM/index.html';
const OUT = 'samples/kanesaka.json';

const html = fs.readFileSync(SRC, 'utf8');

// ── 카네사카 SVG 영역 찾기 ──
// '<svg viewBox="0 0 380 1800"' 같은 형식, 또는 nK0 (카네사카 본점) 포함 영역
// 가장 안전: 카네사카 첫 노드 nK0 위치 ~ 마지막 노드 nKhashira 위치 사이
const startMarker = html.indexOf('<g id="nK0"');
if (startMarker < 0) { console.error('nK0 못 찾음'); process.exit(1); }

// 카네사카 SVG 의 시작 (위쪽 path 들 포함 위해 마커 위로 일정 영역 확장)
// 'lpK_mainTrunk' 정의가 보통 nK 노드들보다 앞에 있음
const trunkIdx = html.indexOf('id="lpK_mainTrunk"');
const svgRegionStart = Math.min(startMarker, trunkIdx >= 0 ? trunkIdx - 200 : startMarker);

// 끝: 카네사카 SVG 의 닫는 </svg> — 다음 큐베이/사이토 SVG 시작 전
const sugitaSvgEnd = html.indexOf('<!-- ', startMarker + 50000); // 충분히 멀리
const regionEnd = sugitaSvgEnd > 0 ? sugitaSvgEnd : startMarker + 50000;
const region = html.slice(svgRegionStart, regionEnd);

// ── 노드 파싱 ──
const nodes = [];
const nodeRe = /<g id="(nK[A-Za-z0-9_]+)"[^>]*onclick="tapNodeK\('([^']+)'\)[^>]*>([\s\S]*?)<\/g>/g;
let m;
while ((m = nodeRe.exec(region))) {
  const elId = m[1];
  const chefId = m[2];
  const inner = m[3];

  // 첫 rect 좌표 (테두리)
  const rectMatch = inner.match(/<rect[^>]*x="([\d.-]+)"[^>]*y="([\d.-]+)"[^>]*width="([\d.-]+)"[^>]*height="([\d.-]+)"/);
  if (!rectMatch) continue;
  const rx = parseFloat(rectMatch[1]);
  const ry = parseFloat(rectMatch[2]);
  const rw = parseFloat(rectMatch[3]);
  const rh = parseFloat(rectMatch[4]);
  const cx = Math.round(rx + rw / 2);
  const cy = Math.round(ry + rh / 2);

  // 이름 텍스트 (첫 번째 text 중 cy+30 ~ cy+50 근처)
  const textMatches = [...inner.matchAll(/<text[^>]*x="([\d.-]+)"[^>]*y="([\d.-]+)"[^>]*>([^<]*)<\/text>/g)];
  let name = '', sub = '';
  for (const t of textMatches) {
    const tx = parseFloat(t[1]);
    const ty = parseFloat(t[2]);
    const content = t[3].trim();
    if (!content) continue;
    // 영문 라벨 (예: KANESAKA, SAITO) — skip (font-family Montserrat 또는 letter-spacing 큰 것)
    if (/^[A-Z· \s]+$/.test(content) && content.length < 20) continue;
    if (!name) name = content;
    else if (!sub) sub = content;
  }

  // 테두리 색상
  const strokeMatch = inner.match(/<rect[^>]*stroke="([^"]+)"/);
  let color = '#1a1a18';
  if (strokeMatch) {
    const s = strokeMatch[1];
    if (s.startsWith('#')) color = s;
  }

  // 노드 타입 — nK0 (본점) 만 main, 나머지는 disciple
  const type = elId === 'nK0' ? 'main' : 'disciple';

  nodes.push({
    id: chefId, type, name: name || chefId, sub,
    x: cx, y: cy, color,
    photo: null, desc: ''
  });
}

console.log(`노드 ${nodes.length}개 추출`);
nodes.forEach(n => console.log(`  ${n.id}: ${n.name} (${n.x},${n.y})`));

// ── path 파싱 ──
const lines = [];
const pathRe = /<path id="(lpK_[A-Za-z0-9_]+)"[^>]*?d="([^"]+)"\/>/g;
let pm;
let pathCount = 0;
while ((pm = pathRe.exec(region))) {
  const lineId = pm[1];
  const d = pm[2];
  pathCount++;

  // d 파싱 — M, L 만 처리
  const segs = [];
  const segRe = /([MLml])\s*(-?[\d.]+)[ ,]+(-?[\d.]+)/g;
  let sm;
  while ((sm = segRe.exec(d))) {
    segs.push({ cmd: sm[1], x: parseFloat(sm[2]), y: parseFloat(sm[3]) });
  }
  if (segs.length < 2) continue;

  const startPt = { x: segs[0].x, y: segs[0].y };
  const endPt = { x: segs[segs.length - 1].x, y: segs[segs.length - 1].y };
  const waypoints = segs.slice(1, -1).map(s => ({ x: Math.round(s.x), y: Math.round(s.y) }));

  // from/to 노드 추정 — 노드 중심 또는 박스 4면 중앙 중 가장 가까운
  //   TAAM path 끝점은 보통 박스 가장자리 (cx±35, cy / cx, cy±35 / cx, cy+67)
  const findNear = (pt, threshold = 25) => {
    let best = null, bestD = threshold;
    for (const n of nodes) {
      const candidates = [
        { x: n.x, y: n.y },              // 중심
        { x: n.x, y: n.y - 35 },         // 상단
        { x: n.x, y: n.y + 35 },         // 하단 박스
        { x: n.x, y: n.y + 67 },         // 하단 이름영역 끝
        { x: n.x - 35, y: n.y },         // 좌
        { x: n.x + 35, y: n.y }          // 우
      ];
      for (const c of candidates) {
        const dd = Math.hypot(c.x - pt.x, c.y - pt.y);
        if (dd < bestD) { bestD = dd; best = n; }
      }
    }
    return best;
  };
  const fromNode = findNear(startPt);
  const toNode = findNear(endPt);

  // 라인 굵기 — trunk 류는 parent (굵음), 나머지는 branch (얇음)
  const lineType = /(mainTrunk|branchR|saitoDown|koreaTrunk|shotaDown)/i.test(lineId) ? 'parent' : 'branch';

  if (!fromNode || !toNode || fromNode.id === toNode.id) {
    // 🆕 from/to 매칭 안 되는 케이스 — raw path 로 보존 (시각적 동일)
    //   TAAM 의 가운데 트렁크 (x=190) 에서 분기하는 path 들 + 트렁크 자체
    lines.push({
      id: lineId,
      type: lineType,
      raw: true,            // raw path 플래그
      rawD: d,              // 원본 d 속성 그대로
      points: []
    });
    console.log(`  ◇ ${lineId}: raw path 보존 (start=${startPt.x},${startPt.y} end=${endPt.x},${endPt.y})`);
    continue;
  }

  lines.push({
    id: lineId,
    type: lineType,
    from: { nodeId: fromNode.id, side: 'auto' },
    to: { nodeId: toNode.id, side: 'auto' },
    points: waypoints
  });
}

console.log(`\npath ${pathCount}개 중 ${lines.length}개 매칭 성공`);

// ── 출력 ──
const yMax = Math.max(...nodes.map(n => n.y), 800);
const result = {
  version: 1,
  lineage: 'kanesaka',
  timeline: { start: 2000, end: 2026, pxPerYear: Math.max(1, Math.round((yMax - 60) / 26)), marginTop: 60, excludedYears: [] },
  nodes,
  lines
};

if (!fs.existsSync('samples')) fs.mkdirSync('samples');
fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
console.log(`\n✅ ${OUT} 생성 완료 (${nodes.length} 노드 + ${lines.length} 라인)`);
