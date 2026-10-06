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

var INK = [47, 49, 245];   // --palette-royal-blue; the page sends the live value
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
      var mix = function (i) { return Math.round(255 + (INK[i] - 255) * t); };
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

/* How far an element can reach from its chunk's x: a distant range runs up
   to 1500 to the right of where it starts; the rest spread both ways. */
var REACH_LEFT = 1600;
var REACH_RIGHT = 800;

self.onmessage = function (e) {
  var d = e.data;
  if (d.type === 'init') {
    Math.seed(d.seed);
    if (d.ink) INK = d.ink;
    colourCache = {};
    return;
  }
  if (d.type !== 'tile') return;
  var x0 = d.k * d.T;
  var x1 = x0 + d.T;
  chunkloader(x0 - REACH_LEFT, x1 + REACH_RIGHT);

  var W = Math.ceil(d.T * d.scale);
  var H = Math.ceil((d.y1 - d.y0) * d.scale);
  var canvas = new OffscreenCanvas(W, H);
  var ctx = canvas.getContext('2d');
  ctx.setTransform(d.scale, 0, 0, d.scale, -x0 * d.scale, -d.y0 * d.scale);
  ctx.lineJoin = 'miter';
  for (var i = 0; i < MEM.chunks.length; i++) {
    var c = MEM.chunks[i];
    if (c.x < x0 - REACH_LEFT || c.x > x1 + REACH_RIGHT) continue;
    paint(ctx, c.canv);
  }
  // Fade the top and bottom edges out.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'destination-in';
  var g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, d.fadeTop > 0 ? 'rgba(0,0,0,0)' : 'rgba(0,0,0,1)');
  if (d.fadeTop > 0) g.addColorStop(d.fadeTop, 'rgba(0,0,0,1)');
  g.addColorStop(1 - d.fadeBottom, 'rgba(0,0,0,1)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  var bitmap = canvas.transferToImageBitmap();
  self.postMessage({ type: 'tile', k: d.k, scale: d.scale, bitmap: bitmap }, [bitmap]);
};
