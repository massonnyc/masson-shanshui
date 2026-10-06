/* The landscape's tile painter, for /centered version E (src/scripts/machine/
 * landscape.ts). A classic worker: generator.js is Lingdong Huang's
 * shan-shui-inf (MIT, see its header), loaded as is.
 *
 * The page asks for tiles by index; tile k covers landscape x from k·T to
 * (k+1)·T and y from y0 to y1, in the generator's own units. For each one
 * we generate whatever chunks it needs (both directions), then paint every
 * element overlapping it, in the generator's back-to-front order, straight
 * to an OffscreenCanvas:
 *   - ink (greys, black) becomes the palette colour the page sends (royal
 *     blue), tone kept: the generator's main grey (100) is the full
 *     colour, lighter greys are lighter
 *     tints, and white stays white (the fills that let near hills hide far
 *     ones);
 *   - there is no paper: the ground is transparent;
 *   - the bottom edge fades out (and the top, if asked), baked in.
 * The tile goes back as an ImageBitmap, so the page never parses SVG.
 */
importScripts('generator.js');

/* ── What the landscape holds: presets (2026-10-06) ──
   The generator plans each stretch with mountplanner(): detailed
   foreground mountains ('mount', each with water at its foot), distant
   ranges ('distmount', every 1000 units), low flat hills where there are
   no mountains ('flatmount') and boats ('boat'). We wrap it without editing
   generator.js: keep each kind with a probability, add a second distant
   range between the first ones, and draw foreground mountains with less
   texture or no trees (Mount.mountain's own tex and veg). Whether an item
   stays is a hash of its x, not Math.random (the generator's seeded PRNG),
   so a preset always gives the same view of a seed.
   The page picks the preset (landscape.ts, key `l`). */
var PRESETS = {
  full:    { mount: 1,    flat: 1,   boat: 1,   dist2: false, tex: 1,   veg: true },
  sparse:  { mount: 0.34, flat: 0.5, boat: 0.5, dist2: false, tex: 1,   veg: true },
  distant: { mount: 0.12, flat: 0.3, boat: 0.3, dist2: true,  tex: 1,   veg: true },
  plain:   { mount: 0.34, flat: 0.5, boat: 0.5, dist2: false, tex: 0.5, veg: false },
};
var preset = PRESETS.full;
var keep = function (x, p) {
  if (p >= 1) return true;
  var h = Math.sin(x * 12.9898 + 78.233) * 43758.5453;
  return h - Math.floor(h) < p;
};
var planAll = mountplanner;
mountplanner = function (xmin, xmax) {
  var out = [];
  var plan = planAll(xmin, xmax);
  for (var i = 0; i < plan.length; i++) {
    var r = plan[i];
    if (r.tag === 'mount' && !keep(r.x, preset.mount)) continue;
    if (r.tag === 'flatmount' && !keep(r.x, preset.flat)) continue;
    if (r.tag === 'boat' && !keep(r.x, preset.boat)) continue;
    out.push(r);
    if (r.tag === 'distmount' && preset.dist2) {
      out.push({ tag: 'distmount', x: r.x + 500, y: r.y - 20, h: r.h });
    }
  }
  return out;
};
var mountainAll = Mount.mountain;
Mount.mountain = function (xoff, yoff, seed, args) {
  args = args || {};
  if (preset.tex !== 1 && args.tex === undefined) args.tex = 200 * preset.tex;
  if (!preset.veg && args.veg === undefined) args.veg = false;
  return mountainAll(xoff, yoff, seed, args);
};

var INK = [47, 49, 245];   // --palette-royal-blue; the page sends the live value
var PAPER = [255, 255, 255];   // the page's colour: white fills and pale greys go to it
var colourCache = {};

function mapColour(c) {
  if (c in colourCache) return colourCache[c];
  var out;
  var s = c.trim();
  var m = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
  var r, g, b, a = 1;
  if (m) { r = +m[1]; g = +m[2]; b = +m[3]; if (m[4] !== undefined) a = +m[4]; }
  else if (s === 'white') { r = g = b = 255; }
  else if (s === 'black' || s === 'red') { r = g = b = 0; }
  else { out = null; }   // none, transparent
  if (out !== null) {
    if (a <= 0) out = null;
    else {
      // Tone: how dark the grey is, with the generator's ink grey (100) as
      // full blue.
      var grey = (r + g + b) / 3;
      var t = Math.max(0, Math.min(1, (255 - grey) / 155));
      // From the page's colour (white fills become it) to the ink.
      var mix = function (i) { return Math.round(PAPER[i] + (INK[i] - PAPER[i]) * t); };
      out = 'rgba(' + mix(0) + ',' + mix(1) + ',' + mix(2) + ',' + a + ')';
    }
  }
  colourCache[c] = out;
  return out;
}

var EL = /<polyline points='([^']*)' style='fill:([^;]*);stroke:([^;]*);stroke-width:([^']*)'\/>|<text font-size='([^']*)'[^>]*?style='fill:([^']*)'[^>]*?transform='translate\(([^,]*),([^)]*)\) rotate\(([^)]*)\)'>([^<]*)<\/text>/g;

function paint(ctx, svg) {
  EL.lastIndex = 0;
  var m;
  while ((m = EL.exec(svg))) {
    if (m[1] !== undefined) {
      var fill = mapColour(m[2]);
      var stroke = mapColour(m[3]);
      var w = parseFloat(m[4]) || 0;
      if (!fill && !(stroke && w > 0)) continue;
      var pts = m[1].trim().split(/\s+/);
      if (pts.length < 2) continue;
      ctx.beginPath();
      for (var i = 0; i < pts.length; i++) {
        var p = pts[i].split(',');
        var x = +p[0], y = +p[1];
        if (x !== x || y !== y) continue;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      if (stroke && w > 0) { ctx.lineWidth = w; ctx.strokeStyle = stroke; ctx.stroke(); }
    } else {
      var col = mapColour(m[6]);
      if (!col) continue;
      ctx.save();
      ctx.translate(+m[7], +m[8]);
      ctx.rotate((+m[9] * Math.PI) / 180);
      ctx.font = (+m[5]) + 'px serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = col;
      ctx.fillText(m[10], 0, 0);
      ctx.restore();
    }
  }
}

/* ── Depth layers (2026-10-06) ──
   Each planned item has a depth: its y in the plan (water is stored
   10000 above its mountain, so it's put back with it). The page paints
   three layers, each moving at its own speed (landscape.ts):
     0 far     the distant ranges
     1 middle  foreground mountains further back (depth < 420), their
               water and boats
     2 near    the rest, and the flat hills
   Measured over 6000 units (seed 7): mountain depths 300–630, 71 items
   behind 420 and 66 in front; distant ranges inked between y 143 and
   292, so the far layer's tiles need only that strip. */
var NEAR_DEPTH = 420;
function layerOf(c) {
  if (c.layer !== undefined) return c.layer;
  var depth = c.y < -1000 ? c.y + 10000 : c.y;
  c.layer = c.tag === 'distmount' ? 0 : c.tag === 'flatmount' ? 2 : depth < NEAR_DEPTH ? 1 : 2;
  return c.layer;
}

/* ── The loop (2026-10-06) ──
   With LOOP set (in units), the landscape is one stretch, x 0 to LOOP,
   repeated: generated once (on demand, as tiles need it, so nothing waits
   for the whole stretch) and painted into each tile at every copy, x + m·LOOP,
   that reaches it. A mountain crossing the end of the stretch carries on
   into its start, so there is no seam. Nothing is generated past the
   stretch, so the worker's memory is fixed. 0: endless, as before. */
var LOOP = 0;
function ensureLoop(hi) {
  if (hi <= 0) return;
  chunkloader(0, Math.min(hi, LOOP));
  MEM.chunks = MEM.chunks.filter(function (c) { return c.x >= 0 && c.x < LOOP; });
}

/* How far an element can reach from its chunk's x: a distant range runs up
   to 1500 to the right of where it starts; the rest spread both ways. */
var REACH_LEFT = 1600;
var REACH_RIGHT = 800;

self.onmessage = function (e) {
  var d = e.data;
  if (d.type === 'init') {
    // A fresh landscape: the seed, the preset, and nothing generated yet.
    Math.seed(d.seed);
    if (d.ink) INK = d.ink;
    if (d.paper) PAPER = d.paper;
    preset = PRESETS[d.preset] || PRESETS.full;
    MEM.chunks = [];
    MEM.xmin = 0;
    MEM.xmax = 0;
    MEM.planmtx = [];
    LOOP = d.loop || 0;
    colourCache = {};
    return;
  }
  /* Forget the landscape behind x (the slowest layer's view, less a
     margin), or the worker keeps every chunk it ever made: about 1MB of
     SVG a second at speed. MEM.xmin stays put, so nothing behind is made
     again. */
  if (d.type === 'prune') {
    if (LOOP) return;             // the loop is all there is
    MEM.chunks = MEM.chunks.filter(function (c) { return c.x >= d.x; });
    return;
  }
  if (d.type !== 'tile') return;
  var x0 = d.k * d.T;
  var x1 = x0 + d.T;
  var lo = x0 - REACH_LEFT;
  var hi = x1 + REACH_RIGHT;
  // Looping: the copies of the stretch that reach this tile, and the
  // stretch generated as far as they need.
  var mLo = 0, mHi = 0;
  if (LOOP) {
    mLo = Math.floor(lo / LOOP);
    mHi = Math.floor(hi / LOOP);
    ensureLoop(mHi > mLo ? LOOP : hi - mLo * LOOP);
  } else {
    chunkloader(lo, hi);
  }

  var W = Math.ceil(d.T * d.scale);
  var H = Math.ceil((d.y1 - d.y0) * d.scale);
  var canvas = new OffscreenCanvas(W, H);
  var ctx = canvas.getContext('2d');
  ctx.setTransform(d.scale, 0, 0, d.scale, -x0 * d.scale, -d.y0 * d.scale);
  ctx.lineJoin = 'miter';
  for (var i = 0; i < MEM.chunks.length; i++) {
    var c = MEM.chunks[i];
    if (d.layer !== undefined && layerOf(c) !== d.layer) continue;
    for (var m = mLo; m <= mHi; m++) {
      var X = c.x + m * LOOP;
      if (X < lo || X > hi) continue;
      if (m === 0) { paint(ctx, c.canv); continue; }
      ctx.save();
      ctx.translate(m * LOOP, 0);
      paint(ctx, c.canv);
      ctx.restore();
    }
  }
  // Fade the top and bottom edges out.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'destination-in';
  var g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, d.fadeTop > 0 ? 'rgba(0,0,0,0)' : 'rgba(0,0,0,1)');
  if (d.fadeTop > 0) g.addColorStop(d.fadeTop, 'rgba(0,0,0,1)');
  g.addColorStop(1 - d.fadeBottom, 'rgba(0,0,0,1)');
  g.addColorStop(1, d.fadeBottom > 0 ? 'rgba(0,0,0,0)' : 'rgba(0,0,0,1)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  var bitmap = canvas.transferToImageBitmap();
  self.postMessage({ type: 'tile', k: d.k, layer: d.layer, scale: d.scale, gen: d.gen, bitmap: bitmap }, [bitmap]);
};
