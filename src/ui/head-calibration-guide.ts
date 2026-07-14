const SVG_NS = 'http://www.w3.org/2000/svg'

export function renderHeadCalibrationGuide(status: {
  headRecognized: boolean
  shouldersRecognized: boolean
}): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.classList.add('head-calibration-guide')
  svg.setAttribute('viewBox', '0 0 300 360')
  svg.setAttribute('aria-hidden', 'true')

  const outline = document.createElementNS(SVG_NS, 'g')
  outline.dataset.outline = 'human-head-shoulders'

  const head = document.createElementNS(SVG_NS, 'path')
  head.classList.add('head-guide-outline', 'head')
  if (status.headRecognized) head.classList.add('recognized')
  head.setAttribute('d', [
    'M 150 20',
    'C 121 20 102 39 96 68',
    'C 92 84 93 100 96 108',
    'C 89 104 85 112 86 123',
    'C 87 136 91 145 97 148',
    'C 102 161 112 170 125 176',
    'C 134 182 142 186 150 187',
    'C 158 186 166 182 175 176',
    'C 188 170 198 161 203 148',
    'C 209 145 213 136 214 123',
    'C 215 112 211 104 204 108',
    'C 207 100 208 84 204 68',
    'C 198 39 179 20 150 20',
    'Z',
  ].join(' '))

  const shoulders = document.createElementNS(SVG_NS, 'path')
  shoulders.classList.add('head-guide-outline', 'shoulders')
  if (status.shouldersRecognized) shoulders.classList.add('recognized')
  shoulders.setAttribute('d', [
    'M 123 176',
    'C 124 193 125 210 123 223',
    'C 117 236 108 246 96 252',
    'C 65 266 34 289 15 318',
    'M 177 176',
    'C 176 193 175 210 177 223',
    'C 183 236 192 246 204 252',
    'C 235 266 266 289 285 318',
  ].join(' '))

  outline.append(shoulders, head)
  svg.append(outline)

  const points = [
    ['head-top', 150, 20, status.headRecognized],
    ['left-cheek', 97, 148, status.headRecognized],
    ['right-cheek', 203, 148, status.headRecognized],
    ['left-shoulder', 55, 273, status.shouldersRecognized],
    ['right-shoulder', 245, 273, status.shouldersRecognized],
  ] as const

  for (const [name, cx, cy, recognized] of points) {
    const point = document.createElementNS(SVG_NS, 'circle')
    point.classList.add('head-guide-point')
    if (recognized) point.classList.add('recognized')
    point.dataset.guidePoint = name
    point.setAttribute('cx', String(cx))
    point.setAttribute('cy', String(cy))
    point.setAttribute('r', '7')
    svg.append(point)
  }

  return svg
}
