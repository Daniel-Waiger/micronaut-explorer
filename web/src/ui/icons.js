// Small, Lucide-style SVGs used throughout the planner. Keeping them local
// avoids a runtime dependency while giving each workflow surface an icon that
// describes microscopy planning rather than a generic office tool.

const ICONS = {
  home: [
    ['rect', 'x=3,y=3,width=7,height=7,rx=1'],
    ['rect', 'x=14,y=3,width=7,height=7,rx=1'],
    ['rect', 'x=3,y=14,width=7,height=7,rx=1'],
    ['path', 'M14 17h7M17.5 13.5v7'],
  ],
  describe: [
    ['path', 'M5 3h9l5 5v13H5z'],
    ['path', 'M14 3v6h6M8 14h4M8 18h3'],
    ['circle', 'cx=16,cy=17,r=2.5'],
    ['path', 'M18 19l2.3 2.3'],
  ],
  study: [
    ['path', 'M9 3h6M10 3v6l-5.5 9.5A2.5 2.5 0 0 0 6.7 22h10.6a2.5 2.5 0 0 0 2.2-3.5L14 9V3'],
    ['path', 'M7.5 17h9'],
  ],
  design: [
    ['path', 'M4 7h16M4 17h16M8 4v6M16 14v6'],
    ['circle', 'cx=8,cy=7,r=2'],
    ['circle', 'cx=16,cy=17,r=2'],
  ],
  microscope: [
    ['path', 'M6 18h8'],
    ['path', 'M3 22h18'],
    ['path', 'M14 22a7 7 0 0 0 0-14h-1'],
    ['path', 'M9 14h2M9 8h2'],
    ['path', 'M10 6v4M5 2l3 3M7 4 4 7'],
  ],
  naming: [
    ['path', 'M20 13 13 20 4 11V4h7z'],
    ['circle', 'cx=8.5,cy=8.5,r=1'],
    ['path', 'm14 14 3 3'],
  ],
  overview: [
    ['circle', 'cx=6,cy=6,r=2.5'],
    ['circle', 'cx=18,cy=7,r=2.5'],
    ['circle', 'cx=12,cy=18,r=2.5'],
    ['path', 'm8.2 7.1 7.5-.2M7.8 8.1l2.8 7.4m5.6-6.1-2.7 6.2'],
  ],
  guide: [
    ['path', 'M4 5.5A2.5 2.5 0 0 1 6.5 3H12v17H6.5A2.5 2.5 0 0 0 4 22z'],
    ['path', 'M20 5.5A2.5 2.5 0 0 0 17.5 3H12v17h5.5A2.5 2.5 0 0 1 20 22z'],
  ],
  add: [
    ['circle', 'cx=12,cy=12,r=9'],
    ['path', 'M12 8v8M8 12h8'],
  ],
  close: [['path', 'M6 6l12 12M18 6 6 18']],
  walkthrough: [
    ['circle', 'cx=5,cy=5,r=2'],
    ['circle', 'cx=19,cy=19,r=2'],
    ['path', 'M7 5h4a4 4 0 0 1 4 4v2a4 4 0 0 0 4 4'],
  ],
  template: [
    ['rect', 'x=5,y=3,width=14,height=18,rx=2'],
    ['path', 'M9 8h6M9 12h6M9 16h4'],
    ['path', 'M3 7v12a2 2 0 0 0 2 2'],
  ],
  lightbulb: [
    ['path', 'M9 18h6M10 22h4'],
    ['path', 'M8 14a6 6 0 1 1 8 0c-.9.8-1.4 1.7-1.5 3h-5c-.1-1.3-.6-2.2-1.5-3'],
  ],
  folder: [
    ['path', 'M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'],
    ['circle', 'cx=12,cy=13,r=2.5'],
    ['path', 'm14 15 2 2'],
  ],
  feedback: [
    ['path', 'M5 5h14v10H9l-4 4z'],
    ['path', 'M8 9h8M8 12h5'],
  ],
  settings: [
    ['circle', 'cx=12,cy=12,r=3'],
    ['path', 'M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.5-2.3 1A7 7 0 0 0 15 6l-.3-2.5h-5L9.4 6a7 7 0 0 0-1.5 1L5.6 6 3.6 9.5l2 1.5a7 7 0 0 0 0 2l-2 1.5 2 3.5 2.3-1a7 7 0 0 0 1.5 1l.3 2.5h5l.3-2.5a7 7 0 0 0 1.5-1l2.3 1 2-3.5-2-1.5c.1-.3.1-.7.1-1z'],
  ],
};

function parseAttributes(source) {
  if (!source.includes('=')) return { d: source };
  return Object.fromEntries(source.split(',').map((entry) => entry.split('=')));
}

export function createIcon(name, className) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  if (className) svg.classList.add(className);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');

  const parts = ICONS[name] || [['circle', 'cx=12,cy=12,r=7']];
  for (const [tag, source] of parts) {
    const part = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [attribute, value] of Object.entries(parseAttributes(source))) {
      part.setAttribute(attribute, value);
    }
    svg.appendChild(part);
  }
  return svg;
}
