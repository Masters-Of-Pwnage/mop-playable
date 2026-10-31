/**
 * Computes where every card on the table should be drawn. The game view keeps
 * all cards in one absolutely positioned layer and tweens them to these targets,
 * so cards visibly fly between zones.
 */
import { Zone } from '../engine/engine.js';

export const CARD_RATIO = 63 / 88;

/**
 * @param {object} o
 * @param {object} o.engine GameEngine
 * @param {number} o.seat   seat shown at the bottom
 * @param {object} o.rects  { oppFront, oppBack, myFront, myBack, hand, oppHand, stack } in layer coordinates
 * @param {number} o.selected selected iid
 * @param {number} o.hover hovered iid
 * @param {boolean} o.hideHand hide the local hand (hotseat privacy)
 */
export function computeLayout({ engine, seat, rects, selected = -1, hover = -1, hideHand = false, maxCardHeight = 230 }) {
  const out = {};
  const s = engine.state;
  if (!s.players.length) return out;
  const opp = 1 - seat;
  for (const p of [seat, opp]) {
    const mine = p === seat;
    const front = mine ? rects.myFront : rects.oppFront;
    const back = mine ? rects.myBack : rects.oppBack;
    if (!front || !back) continue;
    const ps = s.players[p];
    const creatures = [];
    const lands = [];
    const others = [];
    const attached = [];
    for (const iid of ps.battlefield) {
      const c = engine.card(iid);
      const host = c.attachedTo !== -1 ? engine.card(c.attachedTo) : null;
      if (host && host.zone === Zone.BATTLEFIELD) attached.push(iid);
      else if (engine.isCreature(c) || engine.isPlaneswalker(c)) creatures.push(iid);
      else if (engine.isLand(c)) lands.push(iid);
      else others.push(iid);
    }
    lands.sort((a, b) => {
      const ca = engine.card(a);
      const cb = engine.card(b);
      return ca.uid.localeCompare(cb.uid) || Number(ca.tapped) - Number(cb.tapped);
    });
    layoutRow(engine, creatures, front, 'center', out, mine, selected, hover, false, maxCardHeight);
    const landW = back.w * (others.length ? 0.62 : 1);
    layoutRow(engine, lands, { x: back.x, y: back.y, w: landW, h: back.h }, 'left', out, mine, selected, hover, true, maxCardHeight);
    if (others.length) layoutRow(engine, others, { x: back.x + landW + 6, y: back.y, w: back.w - landW - 6, h: back.h }, 'right', out, mine, selected, hover, false, maxCardHeight);
    for (const iid of attached) {
      const host = out[engine.card(iid).attachedTo];
      if (!host) continue;
      out[iid] = { x: host.x - host.w * 0.18, y: host.y - host.h * 0.14, w: host.w, h: host.h, rot: 0, z: host.z - 1, faceDown: false, scale: 1 };
    }
  }
  layoutHand(engine, seat, rects.hand, out, selected, hover, hideHand);
  layoutOppHand(engine, opp, rects.oppHand, out);
  if (rects.stack) {
    const h = Math.min(rects.stack.h, 210);
    const w = h * CARD_RATIO;
    s.stack.forEach((iid, i) => {
      out[iid] = { x: rects.stack.x + rects.stack.w / 2 - w / 2 + i * 22, y: rects.stack.y + i * 12, w, h, rot: 0, z: 60 + i, faceDown: false, scale: 1 };
    });
  }
  return out;
}

function layoutRow(engine, iids, rect, align, out, mine, selected, hover, stackSame, maxCardHeight) {
  if (!iids.length) return;
  let h = Math.min(rect.h - 6, maxCardHeight);
  let w = h * CARD_RATIO;
  const gap = 6;
  const steps = [];
  let total = 0;
  for (let i = 0; i < iids.length; i += 1) {
    const c = engine.card(iids[i]);
    const slot = c.tapped ? h : w;
    let step = slot + gap;
    if (stackSame && i + 1 < iids.length) {
      const nxt = engine.card(iids[i + 1]);
      if (nxt.uid === c.uid && nxt.tapped === c.tapped && !Object.keys(c.counters).length) step = slot * 0.32;
    }
    steps.push(step);
    total += i < iids.length - 1 ? step : slot;
  }
  let scaleX = 1;
  if (total > rect.w) {
    scaleX = rect.w / total;
    if (scaleX < 0.38) {
      const shrink = Math.max(scaleX / 0.38, 0.55);
      h *= shrink;
      w *= shrink;
      for (let i = 0; i < steps.length; i += 1) steps[i] *= shrink;
      total *= shrink;
      scaleX = Math.min(1, rect.w / total);
    }
  }
  const width = total * scaleX;
  let x = rect.x;
  if (align === 'center') x = rect.x + (rect.w - width) / 2;
  else if (align === 'right') x = rect.x + rect.w - width;
  for (let i = 0; i < iids.length; i += 1) {
    const iid = iids[i];
    const c = engine.card(iid);
    const slot = c.tapped ? h : w;
    let cy = rect.y + rect.h / 2;
    if (c.attacking) cy += mine ? -h * 0.12 : h * 0.12;
    const z = iid === selected || iid === hover ? 50 : 10 + i;
    out[iid] = { x: x + slot / 2 - w / 2, y: cy - h / 2, w, h, rot: c.tapped ? 90 : 0, z, faceDown: false, scale: 1 };
    x += steps[i] * scaleX;
  }
}

function layoutHand(engine, seat, rect, out, selected, hover, hideHand) {
  if (!rect) return;
  const hand = engine.state.players[seat].hand;
  const n = hand.length;
  if (!n) return;
  const h = Math.min(rect.h - 14, 250);
  const w = h * CARD_RATIO;
  const step = Math.min(w * 0.92, (rect.w - w) / Math.max(n - 1, 1));
  const width = step * (n - 1) + w;
  const x0 = rect.x + (rect.w - width) / 2;
  const mid = (n - 1) / 2;
  hand.forEach((iid, i) => {
    const off = i - mid;
    const focused = iid === selected || iid === hover;
    const lift = iid === selected ? h * 0.1 : (focused ? h * 0.05 : 0);
    const y = rect.y + 2 + Math.min(off * off * 1.2, 8) - lift;
    out[iid] = {
      x: x0 + i * step, y, w, h, rot: focused ? 0 : off * Math.min(3, 24 / n), z: focused ? 80 : 20 + i,
      faceDown: hideHand && !engine.card(iid).revealed, scale: focused ? 1.08 : 1, pivotBottom: true,
    };
  });
}

function layoutOppHand(engine, opp, rect, out) {
  if (!rect) return;
  const hand = engine.state.players[opp].hand;
  const n = hand.length;
  if (!n) return;
  const h = rect.h * 1.15;
  const w = h * CARD_RATIO;
  const step = Math.min(w * 0.55, (rect.w - w) / Math.max(n - 1, 1));
  hand.forEach((iid, i) => {
    out[iid] = { x: rect.x + i * step, y: rect.y - h * 0.05, w, h, rot: 0, z: 5 + i, faceDown: !engine.card(iid).revealed, scale: 1 };
  });
}
