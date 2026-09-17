var pmtiles = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // pmtiles.esm.js
  var pmtiles_esm_exports = {};
  __export(pmtiles_esm_exports, {
    Compression: () => O2,
    EtagMismatch: () => T,
    FetchSource: () => k2,
    FileSource: () => te,
    PMTiles: () => H,
    Protocol: () => Y2,
    ResolvedValueCache: () => re,
    SharedPromiseCache: () => V,
    TileType: () => S2,
    bytesToHeader: () => M,
    findTile: () => E,
    getUint64: () => y,
    leafletRasterLayer: () => Q2,
    readVarint: () => w,
    tileIdToZxy: () => Z,
    tileTypeExt: () => U,
    zxyToTileId: () => C2
  });

  // fflate.esm.js
  var An = {};
  var et = (function(n, r, t, e, i) {
    var a = new Worker(An[r] || (An[r] = URL.createObjectURL(new Blob([n + ';addEventListener("error",function(e){e=e.error;postMessage({$e$:[e.message,e.code,e.stack]})})'], { type: "text/javascript" }))));
    return a.onmessage = function(s) {
      var o = s.data, l = o.$e$;
      if (l) {
        var f = new Error(l[0]);
        f.code = l[1], f.stack = l[2], i(f, null);
      } else i(null, o);
    }, a.postMessage(t, e), a;
  });
  var S = Uint8Array;
  var Y = Uint16Array;
  var Ir = Int32Array;
  var pr = new S([0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0, 0, 0, 0]);
  var gr = new S([0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13, 0, 0]);
  var Br = new S([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]);
  var Mn = function(n, r) {
    for (var t = new Y(31), e = 0; e < 31; ++e) t[e] = r += 1 << n[e - 1];
    for (var i = new Ir(t[30]), e = 1; e < 30; ++e) for (var a = t[e]; a < t[e + 1]; ++a) i[a] = a - t[e] << 5 | e;
    return { b: t, r: i };
  };
  var Sn = Mn(pr, 2);
  var rn = Sn.b;
  var $r = Sn.r;
  rn[28] = 258, $r[258] = 28;
  for (Un = Mn(gr, 0), Fn = Un.b, nn = Un.r, Zr = new Y(32768), O = 0; O < 32768; ++O) {
    ar = (O & 43690) >> 1 | (O & 21845) << 1;
    ar = (ar & 52428) >> 2 | (ar & 13107) << 2, ar = (ar & 61680) >> 4 | (ar & 3855) << 4, Zr[O] = ((ar & 65280) >> 8 | (ar & 255) << 8) >> 1;
  }
  var ar;
  var Un;
  var Fn;
  var nn;
  var Zr;
  var O;
  for (Q = (function(n, r, t) {
    for (var e = n.length, i = 0, a = new Y(r); i < e; ++i) n[i] && ++a[n[i] - 1];
    var s = new Y(r);
    for (i = 1; i < r; ++i) s[i] = s[i - 1] + a[i - 1] << 1;
    var o;
    if (t) {
      o = new Y(1 << r);
      var l = 15 - r;
      for (i = 0; i < e; ++i) if (n[i]) for (var f = i << 4 | n[i], h2 = r - n[i], u = s[n[i] - 1]++ << h2, v = u | (1 << h2) - 1; u <= v; ++u) o[Zr[u] >> l] = f;
    } else for (o = new Y(e), i = 0; i < e; ++i) n[i] && (o[i] = Zr[s[n[i] - 1]++] >> 15 - n[i]);
    return o;
  }), er = new S(288), O = 0; O < 144; ++O) er[O] = 8;
  var Q;
  var er;
  var O;
  for (O = 144; O < 256; ++O) er[O] = 9;
  var O;
  for (O = 256; O < 280; ++O) er[O] = 7;
  var O;
  for (O = 280; O < 288; ++O) er[O] = 8;
  var O;
  for (yr = new S(32), O = 0; O < 32; ++O) yr[O] = 5;
  var yr;
  var O;
  var Dn = Q(er, 9, 0);
  var Tn = Q(er, 9, 1);
  var Cn = Q(yr, 5, 0);
  var In = Q(yr, 5, 1);
  var Hr = function(n) {
    for (var r = n[0], t = 1; t < n.length; ++t) n[t] > r && (r = n[t]);
    return r;
  };
  var X = function(n, r, t) {
    var e = r / 8 | 0;
    return (n[e] | n[e + 1] << 8) >> (r & 7) & t;
  };
  var Nr = function(n, r) {
    var t = r / 8 | 0;
    return (n[t] | n[t + 1] << 8 | n[t + 2] << 16) >> (r & 7);
  };
  var wr = function(n) {
    return (n + 7) / 8 | 0;
  };
  var k = function(n, r, t) {
    return (r == null || r < 0) && (r = 0), (t == null || t > n.length) && (t = n.length), new S(n.subarray(r, t));
  };
  var Bn = ["unexpected EOF", "invalid block type", "invalid length/literal", "invalid distance", "stream finished", "no stream handler", , "no callback", "invalid UTF-8 data", "extra field too long", "date not in range 1980-2099", "filename too long", "stream finishing", "invalid zip data"];
  var c = function(n, r, t) {
    var e = new Error(r || Bn[n]);
    if (e.code = n, Error.captureStackTrace && Error.captureStackTrace(e, c), !t) throw e;
    return e;
  };
  var Er = function(n, r, t, e) {
    var i = n.length, a = e ? e.length : 0;
    if (!i || r.f && !r.l) return t || new S(0);
    var s = !t, o = s || r.i != 2, l = r.i;
    s && (t = new S(i * 3));
    var f = function(Tr) {
      var Cr = t.length;
      if (Tr > Cr) {
        var cr = new S(Math.max(Cr * 2, Tr));
        cr.set(t), t = cr;
      }
    }, h2 = r.f || 0, u = r.p || 0, v = r.b || 0, M2 = r.l, m = r.d, A2 = r.m, p = r.n, z2 = i * 8;
    do {
      if (!M2) {
        h2 = X(n, u, 1);
        var U2 = X(n, u + 1, 3);
        if (u += 3, U2) if (U2 == 1) M2 = Tn, m = In, A2 = 9, p = 5;
        else if (U2 == 2) {
          var Z2 = X(n, u, 31) + 257, F2 = X(n, u + 10, 15) + 4, w2 = Z2 + X(n, u + 5, 31) + 1;
          u += 14;
          for (var g2 = new S(w2), E2 = new S(19), T2 = 0; T2 < F2; ++T2) E2[Br[T2]] = X(n, u + T2 * 3, 7);
          u += F2 * 3;
          for (var G2 = Hr(E2), N2 = (1 << G2) - 1, L2 = Q(E2, G2, 1), T2 = 0; T2 < w2; ) {
            var $2 = L2[X(n, u, N2)];
            u += $2 & 15;
            var x2 = $2 >> 4;
            if (x2 < 16) g2[T2++] = x2;
            else {
              var B2 = 0, D2 = 0;
              for (x2 == 16 ? (D2 = 3 + X(n, u, 3), u += 2, B2 = g2[T2 - 1]) : x2 == 17 ? (D2 = 3 + X(n, u, 7), u += 3) : x2 == 18 && (D2 = 11 + X(n, u, 127), u += 7); D2--; ) g2[T2++] = B2;
            }
          }
          var R2 = g2.subarray(0, Z2), H2 = g2.subarray(Z2);
          A2 = Hr(R2), p = Hr(H2), M2 = Q(R2, A2, 1), m = Q(H2, p, 1);
        } else c(1);
        else {
          var x2 = wr(u) + 4, y2 = n[x2 - 4] | n[x2 - 3] << 8, I2 = x2 + y2;
          if (I2 > i) {
            l && c(0);
            break;
          }
          o && f(v + y2), t.set(n.subarray(x2, I2), v), r.b = v += y2, r.p = u = I2 * 8, r.f = h2;
          continue;
        }
        if (u > z2) {
          l && c(0);
          break;
        }
      }
      o && f(v + 131072);
      for (var ir = (1 << A2) - 1, K2 = (1 << p) - 1, _ = u; ; _ = u) {
        var B2 = M2[Nr(n, u) & ir], V2 = B2 >> 4;
        if (u += B2 & 15, u > z2) {
          l && c(0);
          break;
        }
        if (B2 || c(2), V2 < 256) t[v++] = V2;
        else if (V2 == 256) {
          _ = u, M2 = null;
          break;
        } else {
          var W2 = V2 - 254;
          if (V2 > 264) {
            var T2 = V2 - 257, P2 = pr[T2];
            W2 = X(n, u, (1 << P2) - 1) + rn[T2], u += P2;
          }
          var rr = m[Nr(n, u) & K2], lr = rr >> 4;
          rr || c(3), u += rr & 15;
          var H2 = Fn[lr];
          if (lr > 3) {
            var P2 = gr[lr];
            H2 += Nr(n, u) & (1 << P2) - 1, u += P2;
          }
          if (u > z2) {
            l && c(0);
            break;
          }
          o && f(v + 131072);
          var vr = v + W2;
          if (v < H2) {
            var Lr = a - H2, Pr = Math.min(H2, vr);
            for (Lr + v < 0 && c(3); v < Pr; ++v) t[v] = e[Lr + v];
          }
          for (; v < vr; ++v) t[v] = t[v - H2];
        }
      }
      r.l = M2, r.p = _, r.b = v, r.f = h2, M2 && (h2 = 1, r.m = A2, r.d = m, r.n = p);
    } while (!h2);
    return v != t.length && s ? k(t, 0, v) : t.subarray(0, v);
  };
  var nr = function(n, r, t) {
    t <<= r & 7;
    var e = r / 8 | 0;
    n[e] |= t, n[e + 1] |= t >> 8;
  };
  var mr = function(n, r, t) {
    t <<= r & 7;
    var e = r / 8 | 0;
    n[e] |= t, n[e + 1] |= t >> 8, n[e + 2] |= t >> 16;
  };
  var Rr = function(n, r) {
    for (var t = [], e = 0; e < n.length; ++e) n[e] && t.push({ s: e, f: n[e] });
    var i = t.length, a = t.slice();
    if (!i) return { t: tr, l: 0 };
    if (i == 1) {
      var s = new S(t[0].s + 1);
      return s[t[0].s] = 1, { t: s, l: 1 };
    }
    t.sort(function(I2, Z2) {
      return I2.f - Z2.f;
    }), t.push({ s: -1, f: 25001 });
    var o = t[0], l = t[1], f = 0, h2 = 1, u = 2;
    for (t[0] = { s: -1, f: o.f + l.f, l: o, r: l }; h2 != i - 1; ) o = t[t[f].f < t[u].f ? f++ : u++], l = t[f != h2 && t[f].f < t[u].f ? f++ : u++], t[h2++] = { s: -1, f: o.f + l.f, l: o, r: l };
    for (var v = a[0].s, e = 1; e < i; ++e) a[e].s > v && (v = a[e].s);
    var M2 = new Y(v + 1), m = Vr(t[h2 - 1], M2, 0);
    if (m > r) {
      var e = 0, A2 = 0, p = m - r, z2 = 1 << p;
      for (a.sort(function(Z2, F2) {
        return M2[F2.s] - M2[Z2.s] || Z2.f - F2.f;
      }); e < i; ++e) {
        var U2 = a[e].s;
        if (M2[U2] > r) A2 += z2 - (1 << m - M2[U2]), M2[U2] = r;
        else break;
      }
      for (A2 >>= p; A2 > 0; ) {
        var x2 = a[e].s;
        M2[x2] < r ? A2 -= 1 << r - M2[x2]++ - 1 : ++e;
      }
      for (; e >= 0 && A2; --e) {
        var y2 = a[e].s;
        M2[y2] == r && (--M2[y2], ++A2);
      }
      m = r;
    }
    return { t: new S(M2), l: m };
  };
  var Vr = function(n, r, t) {
    return n.s == -1 ? Math.max(Vr(n.l, r, t + 1), Vr(n.r, r, t + 1)) : r[n.s] = t;
  };
  var tn = function(n) {
    for (var r = n.length; r && !n[--r]; ) ;
    for (var t = new Y(++r), e = 0, i = n[0], a = 1, s = function(l) {
      t[e++] = l;
    }, o = 1; o <= r; ++o) if (n[o] == i && o != r) ++a;
    else {
      if (!i && a > 2) {
        for (; a > 138; a -= 138) s(32754);
        a > 2 && (s(a > 10 ? a - 11 << 5 | 28690 : a - 3 << 5 | 12305), a = 0);
      } else if (a > 3) {
        for (s(i), --a; a > 6; a -= 6) s(8304);
        a > 2 && (s(a - 3 << 5 | 8208), a = 0);
      }
      for (; a--; ) s(i);
      a = 1, i = n[o];
    }
    return { c: t.subarray(0, e), n: r };
  };
  var zr = function(n, r) {
    for (var t = 0, e = 0; e < r.length; ++e) t += n[e] * r[e];
    return t;
  };
  var Wr = function(n, r, t) {
    var e = t.length, i = wr(r + 2);
    n[i] = e & 255, n[i + 1] = e >> 8, n[i + 2] = n[i] ^ 255, n[i + 3] = n[i + 1] ^ 255;
    for (var a = 0; a < e; ++a) n[i + a + 4] = t[a];
    return (i + 4 + e) * 8;
  };
  var en = function(n, r, t, e, i, a, s, o, l, f, h2) {
    nr(r, h2++, t), ++i[256];
    for (var u = Rr(i, 15), v = u.t, M2 = u.l, m = Rr(a, 15), A2 = m.t, p = m.l, z2 = tn(v), U2 = z2.c, x2 = z2.n, y2 = tn(A2), I2 = y2.c, Z2 = y2.n, F2 = new Y(19), w2 = 0; w2 < U2.length; ++w2) ++F2[U2[w2] & 31];
    for (var w2 = 0; w2 < I2.length; ++w2) ++F2[I2[w2] & 31];
    for (var g2 = Rr(F2, 7), E2 = g2.t, T2 = g2.l, G2 = 19; G2 > 4 && !E2[Br[G2 - 1]]; --G2) ;
    var N2 = f + 5 << 3, L2 = zr(i, er) + zr(a, yr) + s, $2 = zr(i, v) + zr(a, A2) + s + 14 + 3 * G2 + zr(F2, E2) + 2 * F2[16] + 3 * F2[17] + 7 * F2[18];
    if (l >= 0 && N2 <= L2 && N2 <= $2) return Wr(r, h2, n.subarray(l, l + f));
    var B2, D2, R2, H2;
    if (nr(r, h2, 1 + ($2 < L2)), h2 += 2, $2 < L2) {
      B2 = Q(v, M2, 0), D2 = v, R2 = Q(A2, p, 0), H2 = A2;
      var ir = Q(E2, T2, 0);
      nr(r, h2, x2 - 257), nr(r, h2 + 5, Z2 - 1), nr(r, h2 + 10, G2 - 4), h2 += 14;
      for (var w2 = 0; w2 < G2; ++w2) nr(r, h2 + 3 * w2, E2[Br[w2]]);
      h2 += 3 * G2;
      for (var K2 = [U2, I2], _ = 0; _ < 2; ++_) for (var V2 = K2[_], w2 = 0; w2 < V2.length; ++w2) {
        var W2 = V2[w2] & 31;
        nr(r, h2, ir[W2]), h2 += E2[W2], W2 > 15 && (nr(r, h2, V2[w2] >> 5 & 127), h2 += V2[w2] >> 12);
      }
    } else B2 = Dn, D2 = er, R2 = Cn, H2 = yr;
    for (var w2 = 0; w2 < o; ++w2) {
      var P2 = e[w2];
      if (P2 > 255) {
        var W2 = P2 >> 18 & 31;
        mr(r, h2, B2[W2 + 257]), h2 += D2[W2 + 257], W2 > 7 && (nr(r, h2, P2 >> 23 & 31), h2 += pr[W2]);
        var rr = P2 & 31;
        mr(r, h2, R2[rr]), h2 += H2[rr], rr > 3 && (mr(r, h2, P2 >> 5 & 8191), h2 += gr[rr]);
      } else mr(r, h2, B2[P2]), h2 += D2[P2];
    }
    return mr(r, h2, B2[256]), h2 + D2[256];
  };
  var Zn = new Ir([65540, 131080, 131088, 131104, 262176, 1048704, 1048832, 2114560, 2117632]);
  var tr = new S(0);
  var En = function(n, r, t, e, i, a) {
    var s = a.z || n.length, o = new S(e + s + 5 * (1 + Math.ceil(s / 7e3)) + i), l = o.subarray(e, o.length - i), f = a.l, h2 = (a.r || 0) & 7;
    if (r) {
      h2 && (l[0] = a.r >> 3);
      for (var u = Zn[r - 1], v = u >> 13, M2 = u & 8191, m = (1 << t) - 1, A2 = a.p || new Y(32768), p = a.h || new Y(m + 1), z2 = Math.ceil(t / 3), U2 = 2 * z2, x2 = function(_r) {
        return (n[_r] ^ n[_r + 1] << z2 ^ n[_r + 2] << U2) & m;
      }, y2 = new Ir(25e3), I2 = new Y(288), Z2 = new Y(32), F2 = 0, w2 = 0, g2 = a.i || 0, E2 = 0, T2 = a.w || 0, G2 = 0; g2 + 2 < s; ++g2) {
        var N2 = x2(g2), L2 = g2 & 32767, $2 = p[N2];
        if (A2[L2] = $2, p[N2] = L2, T2 <= g2) {
          var B2 = s - g2;
          if ((F2 > 7e3 || E2 > 24576) && (B2 > 423 || !f)) {
            h2 = en(n, l, 0, y2, I2, Z2, w2, E2, G2, g2 - G2, h2), E2 = F2 = w2 = 0, G2 = g2;
            for (var D2 = 0; D2 < 286; ++D2) I2[D2] = 0;
            for (var D2 = 0; D2 < 30; ++D2) Z2[D2] = 0;
          }
          var R2 = 2, H2 = 0, ir = M2, K2 = L2 - $2 & 32767;
          if (B2 > 2 && N2 == x2(g2 - K2)) for (var _ = Math.min(v, B2) - 1, V2 = Math.min(32767, g2), W2 = Math.min(258, B2); K2 <= V2 && --ir && L2 != $2; ) {
            if (n[g2 + R2] == n[g2 + R2 - K2]) {
              for (var P2 = 0; P2 < W2 && n[g2 + P2] == n[g2 + P2 - K2]; ++P2) ;
              if (P2 > R2) {
                if (R2 = P2, H2 = K2, P2 > _) break;
                for (var rr = Math.min(K2, P2 - 2), lr = 0, D2 = 0; D2 < rr; ++D2) {
                  var vr = g2 - K2 + D2 & 32767, Lr = A2[vr], Pr = vr - Lr & 32767;
                  Pr > lr && (lr = Pr, $2 = vr);
                }
              }
            }
            L2 = $2, $2 = A2[L2], K2 += L2 - $2 & 32767;
          }
          if (H2) {
            y2[E2++] = 268435456 | $r[R2] << 18 | nn[H2];
            var Tr = $r[R2] & 31, Cr = nn[H2] & 31;
            w2 += pr[Tr] + gr[Cr], ++I2[257 + Tr], ++Z2[Cr], T2 = g2 + R2, ++F2;
          } else y2[E2++] = n[g2], ++I2[n[g2]];
        }
      }
      for (g2 = Math.max(g2, T2); g2 < s; ++g2) y2[E2++] = n[g2], ++I2[n[g2]];
      h2 = en(n, l, f, y2, I2, Z2, w2, E2, G2, g2 - G2, h2), f || (a.r = h2 & 7 | l[h2 / 8 | 0] << 3, h2 -= 7, a.h = p, a.p = A2, a.i = g2, a.w = T2);
    } else {
      for (var g2 = a.w || 0; g2 < s + f; g2 += 65535) {
        var cr = g2 + 65535;
        cr >= s && (l[h2 / 8 | 0] = f, cr = s), h2 = Wr(l, h2 + 1, n.subarray(g2, cr));
      }
      a.i = s;
    }
    return k(o, 0, e + wr(h2) + i);
  };
  var Gn = (function() {
    for (var n = new Int32Array(256), r = 0; r < 256; ++r) {
      for (var t = r, e = 9; --e; ) t = (t & 1 && -306674912) ^ t >>> 1;
      n[r] = t;
    }
    return n;
  })();
  var xr = function() {
    var n = -1;
    return { p: function(r) {
      for (var t = n, e = 0; e < r.length; ++e) t = Gn[t & 255 ^ r[e]] ^ t >>> 8;
      n = t;
    }, d: function() {
      return ~n;
    } };
  };
  var Yr = function() {
    var n = 1, r = 0;
    return { p: function(t) {
      for (var e = n, i = r, a = t.length | 0, s = 0; s != a; ) {
        for (var o = Math.min(s + 2655, a); s < o; ++s) i += e += t[s];
        e = (e & 65535) + 15 * (e >> 16), i = (i & 65535) + 15 * (i >> 16);
      }
      n = e, r = i;
    }, d: function() {
      return n %= 65521, r %= 65521, (n & 255) << 24 | (n & 65280) << 8 | (r & 255) << 8 | r >> 8;
    } };
  };
  var hr = function(n, r, t, e, i) {
    if (!i && (i = { l: 1 }, r.dictionary)) {
      var a = r.dictionary.subarray(-32768), s = new S(a.length + n.length);
      s.set(a), s.set(n, a.length), n = s, i.w = a.length;
    }
    return En(n, r.level == null ? 6 : r.level, r.mem == null ? i.l ? Math.ceil(Math.max(8, Math.min(13, Math.log(n.length))) * 1.5) : 20 : 12 + r.mem, t, e, i);
  };
  var Gr = function(n, r) {
    var t = {};
    for (var e in n) t[e] = n[e];
    for (var e in r) t[e] = r[e];
    return t;
  };
  var On = function(n, r, t) {
    for (var e = n(), i = n.toString(), a = i.slice(i.indexOf("[") + 1, i.lastIndexOf("]")).replace(/\s+/g, "").split(","), s = 0; s < e.length; ++s) {
      var o = e[s], l = a[s];
      if (typeof o == "function") {
        r += ";" + l + "=";
        var f = o.toString();
        if (o.prototype) if (f.indexOf("[native code]") != -1) {
          var h2 = f.indexOf(" ", 8) + 1;
          r += f.slice(h2, f.indexOf("(", h2));
        } else {
          r += f;
          for (var u in o.prototype) r += ";" + l + ".prototype." + u + "=" + o.prototype[u].toString();
        }
        else r += f;
      } else t[l] = o;
    }
    return r;
  };
  var jr = [];
  var at = function(n) {
    var r = [];
    for (var t in n) n[t].buffer && r.push((n[t] = new n[t].constructor(n[t])).buffer);
    return r;
  };
  var qn = function(n, r, t, e) {
    if (!jr[t]) {
      for (var i = "", a = {}, s = n.length - 1, o = 0; o < s; ++o) i = On(n[o], i, a);
      jr[t] = { c: On(n[s], i, a), e: a };
    }
    var l = Gr({}, jr[t].e);
    return et(jr[t].c + ";onmessage=function(e){for(var k in e.data)self[k]=e.data[k];onmessage=" + r.toString() + "}", t, l, at(l), e);
  };
  var Ar = function() {
    return [S, Y, Ir, pr, gr, Br, rn, Fn, Tn, In, Zr, Bn, Q, Hr, X, Nr, wr, k, c, Er, Fr, sr, an];
  };
  var Mr = function() {
    return [S, Y, Ir, pr, gr, Br, $r, nn, Dn, er, Cn, yr, Zr, Zn, tr, Q, nr, mr, Rr, Vr, tn, zr, Wr, en, wr, k, En, hr, Or, sr];
  };
  var Pn = function() {
    return [fn, Nn];
  };
  var Hn = function() {
    return [ln];
  };
  var sr = function(n) {
    return postMessage(n, [n.buffer]);
  };
  var an = function(n) {
    return n && { out: n.size && new S(n.size), dictionary: n.dictionary };
  };
  var d = function(n) {
    return n.ondata = function(r, t) {
      return postMessage([r, t], [r.buffer]);
    }, function(r) {
      r.data[0] ? (n.push(r.data[0], r.data[1]), postMessage([r.data[0].length])) : n.flush(r.data[1]);
    };
  };
  var Ur = function(n, r, t, e, i, a, s) {
    var o, l = qn(n, e, i, function(f, h2) {
      f ? (l.terminate(), r.ondata.call(r, f)) : Array.isArray(h2) ? h2.length == 1 ? (r.queuedSize -= h2[0], r.ondrain && r.ondrain(h2[0])) : (h2[1] && l.terminate(), r.ondata.call(r, f, h2[0], h2[1])) : s(h2);
    });
    l.postMessage(t), r.queuedSize = 0, r.push = function(f, h2) {
      r.ondata || c(5), o && r.ondata(c(4, 0, 1), null, !!h2), r.queuedSize += f.length, l.postMessage([f, o = h2], f.buffer instanceof ArrayBuffer ? [f.buffer] : []);
    }, r.terminate = function() {
      l.terminate();
    }, a && (r.flush = function(f) {
      l.postMessage([0, f]);
    });
  };
  var j = function(n, r) {
    return n[r] | n[r + 1] << 8;
  };
  var q = function(n, r) {
    return (n[r] | n[r + 1] << 8 | n[r + 2] << 16 | n[r + 3] << 24) >>> 0;
  };
  var sn = function(n, r) {
    return q(n, r) + q(n, r + 4) * 4294967296;
  };
  var C = function(n, r, t) {
    for (; t; ++r) n[r] = t, t >>>= 8;
  };
  var on = function(n, r) {
    var t = r.filename;
    if (n[0] = 31, n[1] = 139, n[2] = 8, n[8] = r.level < 2 ? 4 : r.level == 9 ? 2 : 0, n[9] = 3, r.mtime != 0 && C(n, 4, Math.floor(new Date(r.mtime || Date.now()) / 1e3)), t) {
      n[3] = 8;
      for (var e = 0; e <= t.length; ++e) n[e + 10] = t.charCodeAt(e);
    }
  };
  var fn = function(n) {
    (n[0] != 31 || n[1] != 139 || n[2] != 8) && c(6, "invalid gzip data");
    var r = n[3], t = 10;
    r & 4 && (t += (n[10] | n[11] << 8) + 2);
    for (var e = (r >> 3 & 1) + (r >> 4 & 1); e > 0; e -= !n[t++]) ;
    return t + (r & 2);
  };
  var Nn = function(n) {
    var r = n.length;
    return (n[r - 4] | n[r - 3] << 8 | n[r - 2] << 16 | n[r - 1] << 24) >>> 0;
  };
  var hn = function(n) {
    return 10 + (n.filename ? n.filename.length + 1 : 0);
  };
  var un = function(n, r) {
    var t = r.level, e = t == 0 ? 0 : t < 6 ? 1 : t == 9 ? 3 : 2;
    if (n[0] = 120, n[1] = e << 6 | (r.dictionary && 32), n[1] |= 31 - (n[0] << 8 | n[1]) % 31, r.dictionary) {
      var i = Yr();
      i.p(r.dictionary), C(n, 2, i.d());
    }
  };
  var ln = function(n, r) {
    return ((n[0] & 15) != 8 || n[0] >> 4 > 7 || (n[0] << 8 | n[1]) % 31) && c(6, "invalid zlib data"), (n[1] >> 5 & 1) == +!r && c(6, "invalid zlib data: " + (n[1] & 32 ? "need" : "unexpected") + " dictionary"), (n[1] >> 3 & 4) + 2;
  };
  function ur(n, r) {
    return typeof n == "function" && (r = n, n = {}), this.ondata = r, n;
  }
  var b = (function() {
    function n(r, t) {
      if (typeof r == "function" && (t = r, r = {}), this.ondata = t, this.o = r || {}, this.s = { l: 0, i: 32768, w: 32768, z: 32768 }, this.b = new S(98304), this.o.dictionary) {
        var e = this.o.dictionary.subarray(-32768);
        this.b.set(e, 32768 - e.length), this.s.i = 32768 - e.length;
      }
    }
    return n.prototype.p = function(r, t) {
      this.ondata(hr(r, this.o, 0, 0, this.s), t);
    }, n.prototype.push = function(r, t) {
      this.ondata || c(5), this.s.l && c(4);
      var e = r.length + this.s.z;
      if (e > this.b.length) {
        if (e > 2 * this.b.length - 32768) {
          var i = new S(e & -32768);
          i.set(this.b.subarray(0, this.s.z)), this.b = i;
        }
        var a = this.b.length - this.s.z;
        this.b.set(r.subarray(0, a), this.s.z), this.s.z = this.b.length, this.p(this.b, false), this.b.set(this.b.subarray(-32768)), this.b.set(r.subarray(a), 32768), this.s.z = r.length - a + 32768, this.s.i = 32766, this.s.w = 32768;
      } else this.b.set(r, this.s.z), this.s.z += r.length;
      this.s.l = t & 1, (this.s.z > this.s.w + 8191 || t) && (this.p(this.b, t || false), this.s.w = this.s.i, this.s.i -= 2), t && (this.s = this.o = {}, this.b = tr);
    }, n.prototype.flush = function(r) {
      if (this.ondata || c(5), this.s.l && c(4), this.p(this.b, false), this.s.w = this.s.i, this.s.i -= 2, r) {
        var t = new S(6);
        t[0] = this.s.r >> 3;
        var e = Wr(t, this.s.r, tr);
        this.s.r = 0, this.ondata(t.subarray(0, e >> 3), false);
      }
    }, n;
  })();
  var Rn = /* @__PURE__ */ (function() {
    function n(r, t) {
      Ur([Mr, function() {
        return [d, b];
      }], this, ur.call(this, r, t), function(e) {
        var i = new b(e.data);
        onmessage = d(i);
      }, 6, 1);
    }
    return n;
  })();
  function Or(n, r) {
    return hr(n, r || {}, 0, 0);
  }
  var J = (function() {
    function n(r, t) {
      typeof r == "function" && (t = r, r = {}), this.ondata = t;
      var e = r && r.dictionary && r.dictionary.subarray(-32768);
      this.s = { i: 0, b: e ? e.length : 0 }, this.o = new S(32768), this.p = new S(0), e && this.o.set(e);
    }
    return n.prototype.e = function(r) {
      if (this.ondata || c(5), this.d && c(4), !this.p.length) this.p = r;
      else if (r.length) {
        var t = new S(this.p.length + r.length);
        t.set(this.p), t.set(r, this.p.length), this.p = t;
      }
    }, n.prototype.c = function(r) {
      this.s.i = +(this.d = r || false);
      var t = this.s.b, e = Er(this.p, this.s, this.o);
      this.ondata(k(e, t, this.s.b), this.d), this.o = k(e, this.s.b - 32768), this.s.b = this.o.length, this.p = k(this.p, this.s.p / 8 | 0), this.s.p &= 7;
    }, n.prototype.push = function(r, t) {
      this.e(r), this.c(t);
    }, n;
  })();
  var vn = /* @__PURE__ */ (function() {
    function n(r, t) {
      Ur([Ar, function() {
        return [d, J];
      }], this, ur.call(this, r, t), function(e) {
        var i = new J(e.data);
        onmessage = d(i);
      }, 7, 0);
    }
    return n;
  })();
  function Fr(n, r) {
    return Er(n, { i: 2 }, r && r.out, r && r.dictionary);
  }
  var Jr = (function() {
    function n(r, t) {
      this.c = xr(), this.l = 0, this.v = 1, b.call(this, r, t);
    }
    return n.prototype.push = function(r, t) {
      this.c.p(r), this.l += r.length, b.prototype.push.call(this, r, t);
    }, n.prototype.p = function(r, t) {
      var e = hr(r, this.o, this.v && hn(this.o), t && 8, this.s);
      this.v && (on(e, this.o), this.v = 0), t && (C(e, e.length - 8, this.c.d()), C(e, e.length - 4, this.l)), this.ondata(e, t);
    }, n.prototype.flush = function(r) {
      b.prototype.flush.call(this, r);
    }, n;
  })();
  var Qr = (function() {
    function n(r, t) {
      this.v = 1, this.r = 0, J.call(this, r, t);
    }
    return n.prototype.push = function(r, t) {
      if (J.prototype.e.call(this, r), this.r += r.length, this.v) {
        var e = this.p.subarray(this.v - 1), i = e.length > 3 ? fn(e) : 4;
        if (i > e.length) {
          if (!t) return;
        } else this.v > 1 && this.onmember && this.onmember(this.r - e.length);
        this.p = e.subarray(i), this.v = 0;
      }
      J.prototype.c.call(this, 0), this.s.f && !this.s.l ? (this.v = wr(this.s.p) + 9, this.s = { i: 0 }, this.o = new S(0), this.push(new S(0), t)) : t && J.prototype.c.call(this, t);
    }, n;
  })();
  var jn = /* @__PURE__ */ (function() {
    function n(r, t) {
      var e = this;
      Ur([Ar, Pn, function() {
        return [d, J, Qr];
      }], this, ur.call(this, r, t), function(i) {
        var a = new Qr(i.data);
        a.onmember = function(s) {
          return postMessage(s);
        }, onmessage = d(a);
      }, 9, 0, function(i) {
        return e.onmember && e.onmember(i);
      });
    }
    return n;
  })();
  function Xr(n, r) {
    var t = fn(n);
    return t + 8 > n.length && c(6, "invalid gzip data"), Er(n.subarray(t, -8), { i: 2 }, r && r.out || new S(Nn(n)), r && r.dictionary);
  }
  var pn = (function() {
    function n(r, t) {
      this.c = Yr(), this.v = 1, b.call(this, r, t);
    }
    return n.prototype.push = function(r, t) {
      this.c.p(r), b.prototype.push.call(this, r, t);
    }, n.prototype.p = function(r, t) {
      var e = hr(r, this.o, this.v && (this.o.dictionary ? 6 : 2), t && 4, this.s);
      this.v && (un(e, this.o), this.v = 0), t && C(e, e.length - 4, this.c.d()), this.ondata(e, t);
    }, n.prototype.flush = function(r) {
      b.prototype.flush.call(this, r);
    }, n;
  })();
  var kr = (function() {
    function n(r, t) {
      J.call(this, r, t), this.v = r && r.dictionary ? 2 : 1;
    }
    return n.prototype.push = function(r, t) {
      if (J.prototype.e.call(this, r), this.v) {
        if (this.p.length < 6 && !t) return;
        this.p = this.p.subarray(ln(this.p, this.v - 1)), this.v = 0;
      }
      t && (this.p.length < 4 && c(6, "invalid zlib data"), this.p = this.p.subarray(0, -4)), J.prototype.c.call(this, t);
    }, n;
  })();
  var Kn = /* @__PURE__ */ (function() {
    function n(r, t) {
      Ur([Ar, Hn, function() {
        return [d, J, kr];
      }], this, ur.call(this, r, t), function(e) {
        var i = new kr(e.data);
        onmessage = d(i);
      }, 11, 0);
    }
    return n;
  })();
  function dr(n, r) {
    return Er(n.subarray(ln(n, r && r.dictionary), -4), { i: 2 }, r && r.out, r && r.dictionary);
  }
  var yn = (function() {
    function n(r, t) {
      this.o = ur.call(this, r, t) || {}, this.G = Qr, this.I = J, this.Z = kr;
    }
    return n.prototype.i = function() {
      var r = this;
      this.s.ondata = function(t, e) {
        r.ondata(t, e);
      };
    }, n.prototype.push = function(r, t) {
      if (this.ondata || c(5), this.s) this.s.push(r, t);
      else {
        if (this.p && this.p.length) {
          var e = new S(this.p.length + r.length);
          e.set(this.p), e.set(r, this.p.length);
        } else this.p = r;
        this.p.length > 2 && (this.s = this.p[0] == 31 && this.p[1] == 139 && this.p[2] == 8 ? new this.G(this.o) : (this.p[0] & 15) != 8 || this.p[0] >> 4 > 7 || (this.p[0] << 8 | this.p[1]) % 31 ? new this.I(this.o) : new this.Z(this.o), this.i(), this.s.push(this.p, t), this.p = null);
      }
    }, n;
  })();
  var ft = (function() {
    function n(r, t) {
      yn.call(this, r, t), this.queuedSize = 0, this.G = jn, this.I = vn, this.Z = Kn;
    }
    return n.prototype.i = function() {
      var r = this;
      this.s.ondata = function(t, e, i) {
        r.ondata(t, e, i);
      }, this.s.ondrain = function(t) {
        r.queuedSize -= t, r.ondrain && r.ondrain(t);
      };
    }, n.prototype.push = function(r, t) {
      this.queuedSize += r.length, yn.prototype.push.call(this, r, t);
    }, n;
  })();
  function ut(n, r) {
    return n[0] == 31 && n[1] == 139 && n[2] == 8 ? Xr(n, r) : (n[0] & 15) != 8 || n[0] >> 4 > 7 || (n[0] << 8 | n[1]) % 31 ? Fr(n, r) : dr(n, r);
  }
  var Xn = typeof TextEncoder < "u" && new TextEncoder();
  var mn = typeof TextDecoder < "u" && new TextDecoder();
  var kn = 0;
  try {
    mn.decode(tr, { stream: true }), kn = 1;
  } catch {
  }
  var dn = function(n) {
    for (var r = "", t = 0; ; ) {
      var e = n[t++], i = (e > 127) + (e > 223) + (e > 239);
      if (t + i > n.length) return { s: r, r: k(n, t - 1) };
      i ? i == 3 ? (e = ((e & 15) << 18 | (n[t++] & 63) << 12 | (n[t++] & 63) << 6 | n[t++] & 63) - 65536, r += String.fromCharCode(55296 | e >> 10, 56320 | e & 1023)) : i & 1 ? r += String.fromCharCode((e & 31) << 6 | n[t++] & 63) : r += String.fromCharCode((e & 15) << 12 | (n[t++] & 63) << 6 | n[t++] & 63) : r += String.fromCharCode(e);
    }
  };
  var lt = (function() {
    function n(r) {
      this.ondata = r, kn ? this.t = new TextDecoder() : this.p = tr;
    }
    return n.prototype.push = function(r, t) {
      if (this.ondata || c(5), t = !!t, this.t) {
        this.ondata(this.t.decode(r, { stream: true }), t), t && (this.t.decode().length && c(8), this.t = null);
        return;
      }
      this.p || c(4);
      var e = new S(this.p.length + r.length);
      e.set(this.p), e.set(r, this.p.length);
      var i = dn(e), a = i.s, s = i.r;
      t ? (s.length && c(8), this.p = null) : this.p = s, this.ondata(a, t);
    }, n;
  })();
  var vt = (function() {
    function n(r) {
      this.ondata = r;
    }
    return n.prototype.push = function(r, t) {
      this.ondata || c(5), this.d && c(4), this.ondata(or(r), this.d = t || false);
    }, n;
  })();
  function or(n, r) {
    if (r) {
      for (var t = new S(n.length), e = 0; e < n.length; ++e) t[e] = n.charCodeAt(e);
      return t;
    }
    if (Xn) return Xn.encode(n);
    for (var i = n.length, a = new S(n.length + (n.length >> 1)), s = 0, o = function(h2) {
      a[s++] = h2;
    }, e = 0; e < i; ++e) {
      if (s + 5 > a.length) {
        var l = new S(s + 8 + (i - e << 1));
        l.set(a), a = l;
      }
      var f = n.charCodeAt(e);
      f < 128 || r ? o(f) : f < 2048 ? (o(192 | f >> 6), o(128 | f & 63)) : f > 55295 && f < 57344 ? (f = 65536 + (f & 1047552) | n.charCodeAt(++e) & 1023, o(240 | f >> 18), o(128 | f >> 12 & 63), o(128 | f >> 6 & 63), o(128 | f & 63)) : (o(224 | f >> 12), o(128 | f >> 6 & 63), o(128 | f & 63));
    }
    return k(a, 0, s);
  }
  function zn(n, r) {
    if (r) {
      for (var t = "", e = 0; e < n.length; e += 16384) t += String.fromCharCode.apply(null, n.subarray(e, e + 16384));
      return t;
    } else {
      if (mn) return mn.decode(n);
      var i = dn(n), a = i.s, t = i.r;
      return t.length && c(8), a;
    }
  }
  var bn = function(n) {
    return n == 1 ? 3 : n < 6 ? 2 : n == 9 ? 1 : 0;
  };
  var nt = function(n, r, t, e, i, a, s) {
    var o = i == 4294967295, l = a == 4294967295, f = s == 4294967295, h2 = r + t, u = o + l + f;
    if (e && u) {
      for (; r + 4 < h2; r += 4 + j(n, r + 2)) if (j(n, r) == 1) return [o ? sn(n, r + 4 + 8 * l) : i, l ? sn(n, r + 4) : a, f ? sn(n, r + 4 + 8 * (l + o)) : s, 1];
      e < 2 && c(13);
    }
    return [i, a, s, 0];
  };
  var fr = function(n) {
    var r = 0;
    if (n) for (var t in n) {
      var e = n[t].length;
      e > 65535 && c(9), r += e + 4;
    }
    return r;
  };
  var Dr = function(n, r, t, e, i, a, s, o) {
    var l = e.length, f = t.extra, h2 = o && o.length, u = fr(f);
    C(n, r, s != null ? 33639248 : 67324752), r += 4, s != null && (n[r++] = 20, n[r++] = t.os), n[r] = 20, r += 2, n[r++] = t.flag << 1 | (a < 0 && 8), n[r++] = i && 8, n[r++] = t.compression & 255, n[r++] = t.compression >> 8;
    var v = new Date(t.mtime == null ? Date.now() : t.mtime), M2 = v.getFullYear() - 1980;
    if ((M2 < 0 || M2 > 119) && c(10), C(n, r, M2 << 25 | v.getMonth() + 1 << 21 | v.getDate() << 16 | v.getHours() << 11 | v.getMinutes() << 5 | v.getSeconds() >> 1), r += 4, a != -1 && (C(n, r, t.crc), C(n, r + 4, a < 0 ? -a - 2 : a), C(n, r + 8, t.size)), C(n, r + 12, l), C(n, r + 14, u), r += 16, s != null && (C(n, r, h2), C(n, r + 6, t.attrs), C(n, r + 10, s), r += 14), n.set(e, r), r += l, u) for (var m in f) {
      var A2 = f[m], p = A2.length;
      C(n, r, +m), C(n, r + 2, p), n.set(A2, r + 4), r += 4 + p;
    }
    return h2 && (n.set(o, r), r += h2), r;
  };
  var xn = function(n, r, t, e, i) {
    C(n, r, 101010256), C(n, r + 8, t), C(n, r + 10, t), C(n, r + 12, e), C(n, r + 16, i);
  };
  var qr = (function() {
    function n(r) {
      this.filename = r, this.c = xr(), this.size = 0, this.compression = 0;
    }
    return n.prototype.process = function(r, t) {
      this.ondata(null, r, t);
    }, n.prototype.push = function(r, t) {
      this.ondata || c(5), this.c.p(r), this.size += r.length, t && (this.crc = this.c.d()), this.process(r, t || false);
    }, n;
  })();
  var ct = (function() {
    function n(r, t) {
      var e = this;
      t || (t = {}), qr.call(this, r), this.d = new b(t, function(i, a) {
        e.ondata(null, i, a);
      }), this.compression = 8, this.flag = bn(t.level);
    }
    return n.prototype.process = function(r, t) {
      try {
        this.d.push(r, t);
      } catch (e) {
        this.ondata(e, null, t);
      }
    }, n.prototype.push = function(r, t) {
      qr.prototype.push.call(this, r, t);
    }, n;
  })();
  var pt = (function() {
    function n(r, t) {
      var e = this;
      t || (t = {}), qr.call(this, r), this.d = new Rn(t, function(i, a, s) {
        e.ondata(i, a, s);
      }), this.compression = 8, this.flag = bn(t.level), this.terminate = this.d.terminate;
    }
    return n.prototype.process = function(r, t) {
      this.d.push(r, t);
    }, n.prototype.push = function(r, t) {
      qr.prototype.push.call(this, r, t);
    }, n;
  })();
  var gt = (function() {
    function n(r) {
      this.ondata = r, this.u = [], this.d = 1;
    }
    return n.prototype.add = function(r) {
      var t = this;
      if (this.ondata || c(5), this.d & 2) this.ondata(c(4 + (this.d & 1) * 8, 0, 1), null, false);
      else {
        var e = or(r.filename), i = e.length, a = r.comment, s = a && or(a), o = i != r.filename.length || s && a.length != s.length, l = i + fr(r.extra) + 30;
        i > 65535 && this.ondata(c(11, 0, 1), null, false);
        var f = new S(l);
        Dr(f, 0, r, e, o, -1);
        var h2 = [f], u = function() {
          for (var p = 0, z2 = h2; p < z2.length; p++) {
            var U2 = z2[p];
            t.ondata(null, U2, false);
          }
          h2 = [];
        }, v = this.d;
        this.d = 0;
        var M2 = this.u.length, m = Gr(r, { f: e, u: o, o: s, t: function() {
          r.terminate && r.terminate();
        }, r: function() {
          if (u(), v) {
            var p = t.u[M2 + 1];
            p ? p.r() : t.d = 1;
          }
          v = 1;
        } }), A2 = 0;
        r.ondata = function(p, z2, U2) {
          if (p) t.ondata(p, z2, U2), t.terminate();
          else if (A2 += z2.length, h2.push(z2), U2) {
            var x2 = new S(16);
            C(x2, 0, 134695760), C(x2, 4, r.crc), C(x2, 8, A2), C(x2, 12, r.size), h2.push(x2), m.c = A2, m.b = l + A2 + 16, m.crc = r.crc, m.size = r.size, v && m.r(), v = 1;
          } else v && u();
        }, this.u.push(m);
      }
    }, n.prototype.end = function() {
      var r = this;
      if (this.d & 2) {
        this.ondata(c(4 + (this.d & 1) * 8, 0, 1), null, true);
        return;
      }
      this.d ? this.e() : this.u.push({ r: function() {
        r.d & 1 && (r.u.splice(-1, 1), r.e());
      }, t: function() {
      } }), this.d = 3;
    }, n.prototype.e = function() {
      for (var r = 0, t = 0, e = 0, i = 0, a = this.u; i < a.length; i++) {
        var s = a[i];
        e += 46 + s.f.length + fr(s.extra) + (s.o ? s.o.length : 0);
      }
      for (var o = new S(e + 22), l = 0, f = this.u; l < f.length; l++) {
        var s = f[l];
        Dr(o, r, s, s.f, s.u, -s.c - 2, t, s.o), r += 46 + s.f.length + fr(s.extra) + (s.o ? s.o.length : 0), t += s.b;
      }
      xn(o, r, this.u.length, e, t), this.ondata(null, o, true), this.d = 2;
    }, n.prototype.terminate = function() {
      for (var r = 0, t = this.u; r < t.length; r++) {
        var e = t[r];
        e.t();
      }
      this.d = 2;
    }, n;
  })();
  var tt = (function() {
    function n() {
    }
    return n.prototype.push = function(r, t) {
      this.ondata(null, r, t);
    }, n.compression = 0, n;
  })();
  var mt = (function() {
    function n() {
      var r = this;
      this.i = new J(function(t, e) {
        r.ondata(null, t, e);
      });
    }
    return n.prototype.push = function(r, t) {
      try {
        this.i.push(r, t);
      } catch (e) {
        this.ondata(e, null, t);
      }
    }, n.compression = 8, n;
  })();
  var zt = (function() {
    function n(r, t) {
      var e = this;
      t < 32e4 ? this.i = new J(function(i, a) {
        e.ondata(null, i, a);
      }) : (this.i = new vn(function(i, a, s) {
        e.ondata(i, a, s);
      }), this.terminate = this.i.terminate);
    }
    return n.prototype.push = function(r, t) {
      this.i.terminate && (r = k(r, 0)), this.i.push(r, t);
    }, n.compression = 8, n;
  })();
  var xt = (function() {
    function n(r) {
      this.onfile = r, this.k = [], this.o = { 0: tt }, this.p = tr;
    }
    return n.prototype.push = function(r, t) {
      var e = this;
      if (this.onfile || c(5), this.p || c(4), this.c > 0) {
        var i = Math.min(this.c, r.length), a = r.subarray(0, i);
        if (this.c -= i, this.d ? this.d.push(a, !this.c) : this.k[0].push(a), r = r.subarray(i), r.length) return this.push(r, t);
      } else {
        var s = 0, o = 0, l = void 0, f = void 0;
        this.p.length ? r.length ? (f = new S(this.p.length + r.length), f.set(this.p), f.set(r, this.p.length)) : f = this.p : f = r;
        for (var h2 = f.length, u = this.c, v = u && this.d, M2 = function() {
          var z2 = q(f, o);
          if (z2 == 67324752) {
            s = 1, l = o, m.d = null, m.c = 0;
            var U2 = j(f, o + 6), x2 = j(f, o + 8), y2 = U2 & 2048, I2 = U2 & 8, Z2 = j(f, o + 26), F2 = j(f, o + 28);
            if (h2 > o + 30 + Z2 + F2) {
              var w2 = [];
              m.k.unshift(w2), s = 2;
              var g2 = q(f, o + 18), E2 = q(f, o + 22), T2 = zn(f.subarray(o + 30, o += 30 + Z2), !y2), G2 = nt(f, o, F2, 2, g2, E2, 0), N2 = G2[0], L2 = G2[1], $2 = G2[3];
              I2 && (N2 = -1 - $2), o += F2, m.c = N2;
              var B2, D2 = { name: T2, compression: x2, start: function() {
                if (D2.ondata || c(5), !N2) D2.ondata(null, tr, true);
                else {
                  var R2 = e.o[x2];
                  R2 || D2.ondata(c(14, "unknown compression type " + x2, 1), null, false), B2 = N2 < 0 ? new R2(T2) : new R2(T2, N2, L2), B2.ondata = function(_, V2, W2) {
                    D2.ondata(_, V2, W2);
                  };
                  for (var H2 = 0, ir = w2; H2 < ir.length; H2++) {
                    var K2 = ir[H2];
                    B2.push(K2, false);
                  }
                  e.k[0] == w2 && e.c ? e.d = B2 : B2.push(tr, true);
                }
              }, terminate: function() {
                B2 && B2.terminate && B2.terminate();
              } };
              N2 >= 0 && (D2.size = N2, D2.originalSize = L2), m.onfile(D2);
            }
            return "break";
          } else if (u) {
            if (z2 == 134695760) return l = o += 12 + (u == -2 && 8), s = 3, m.c = 0, "break";
            if (z2 == 33639248) return l = o -= 4, s = 3, m.c = 0, "break";
          }
        }, m = this; o < h2 - 4; ++o) {
          var A2 = M2();
          if (A2 === "break") break;
        }
        if (this.p = tr, u < 0) {
          var p = s ? f.subarray(0, l - 12 - (u == -2 && 8) - (q(f, l - 16) == 134695760 && 4)) : f.subarray(0, o);
          v ? v.push(p, !!s) : this.k[+(s == 2)].push(p);
        }
        if (s & 2) return this.push(f.subarray(o), t);
        this.p = f.subarray(o);
      }
      t && (this.c && c(13), this.p = null);
    }, n.prototype.register = function(r) {
      this.o[r.compression] = r;
    }, n;
  })();

  // pmtiles.esm.js
  var G = Object.defineProperty;
  var q2 = Math.pow;
  var h = (i, t) => G(i, "name", { value: t, configurable: true });
  var g = (i, t, e) => new Promise((r, n) => {
    var s = (l) => {
      try {
        o(e.next(l));
      } catch (c2) {
        n(c2);
      }
    }, a = (l) => {
      try {
        o(e.throw(l));
      } catch (c2) {
        n(c2);
      }
    }, o = (l) => l.done ? r(l.value) : Promise.resolve(l.value).then(s, a);
    o((e = e.apply(i, t)).next());
  });
  var Q2 = h((i, t) => {
    let e = false, r = "", n = L.GridLayer.extend({ createTile: h((s, a) => {
      let o = document.createElement("img"), l = new AbortController(), c2 = l.signal;
      return o.cancel = () => {
        l.abort();
      }, e || (i.getHeader().then((d2) => {
        d2.tileType === 1 || d2.tileType === 6 ? console.error("Error: archive contains vector tiles, but leafletRasterLayer is for displaying raster tiles. See https://github.com/protomaps/PMTiles/tree/main/js for details.") : d2.tileType === 2 ? r = "image/png" : d2.tileType === 3 ? r = "image/jpeg" : d2.tileType === 4 ? r = "image/webp" : d2.tileType === 5 && (r = "image/avif");
      }), e = true), i.getZxy(s.z, s.x, s.y, c2).then((d2) => {
        if (d2) {
          let u = new Blob([d2.data], { type: r }), f = window.URL.createObjectURL(u);
          o.src = f;
        } else o.style.display = "none";
        o.cancel = void 0, a(void 0, o);
      }).catch((d2) => {
        if (d2.name !== "AbortError") throw d2;
      }), o;
    }, "createTile"), _removeTile: h(function(s) {
      let a = this._tiles[s];
      a && (a.el.cancel && a.el.cancel(), a.el.src && window.URL.revokeObjectURL(a.el.src), a.el.width = 0, a.el.height = 0, a.el.deleted = true, L.DomUtil.remove(a.el), delete this._tiles[s], this.fire("tileunload", { tile: a.el, coords: this._keyToTileCoords(s) }));
    }, "_removeTile") });
    return new n(t);
  }, "leafletRasterLayer");
  var X2 = h((i) => (t, e) => {
    if (e instanceof AbortController) return i(t, e);
    let r = new AbortController();
    return i(t, r).then((n) => e(void 0, n.data, n.cacheControl || "", n.expires || ""), (n) => e(n)).catch((n) => e(n)), { cancel: h(() => r.abort(), "cancel") };
  }, "v3compat");
  var z = class {
    constructor(t) {
      this.tilev4 = h((e, r) => g(this, null, function* () {
        if (e.type === "json") {
          let p = e.url.substr(10), v = this.tiles.get(p);
          if (v || (v = new H(p), this.tiles.set(p, v)), this.metadata) {
            let _ = yield v.getTileJson(e.url);
            return r.signal.throwIfAborted(), { data: _ };
          }
          let m = yield v.getHeader();
          return r.signal.throwIfAborted(), (m.minLon >= m.maxLon || m.minLat >= m.maxLat) && console.error(`Bounds of PMTiles archive ${m.minLon},${m.minLat},${m.maxLon},${m.maxLat} are not valid.`), { data: { tiles: [`${e.url}/{z}/{x}/{y}`], minzoom: m.minZoom, maxzoom: m.maxZoom, bounds: [m.minLon, m.minLat, m.maxLon, m.maxLat] } };
        }
        let n = new RegExp(/pmtiles:\/\/(.+)\/(\d+)\/(\d+)\/(\d+)/), s = e.url.match(n);
        if (!s) throw new Error("Invalid PMTiles protocol URL");
        let a = s[1], o = this.tiles.get(a);
        o || (o = new H(a), this.tiles.set(a, o));
        let l = s[2], c2 = s[3], d2 = s[4], u = yield o?.getZxy(+l, +c2, +d2, r.signal);
        if (r.signal.throwIfAborted(), u) return { data: new Uint8Array(u.data), cacheControl: u.cacheControl, expires: u.expires };
        let f = yield o.getHeader();
        if (f.tileType === 1 || f.tileType === 6) {
          if (this.errorOnMissingTile) throw new Error("Tile not found.");
          return { data: new Uint8Array() };
        }
        return { data: null };
      }), "tilev4"), this.tile = X2(this.tilev4), this.tiles = /* @__PURE__ */ new Map(), this.metadata = t?.metadata || false, this.errorOnMissingTile = t?.errorOnMissingTile || false;
    }
    add(t) {
      this.tiles.set(t.source.getKey(), t);
    }
    get(t) {
      return this.tiles.get(t);
    }
  };
  h(z, "Protocol");
  var Y2 = z;
  function I(i, t) {
    return (t >>> 0) * 4294967296 + (i >>> 0);
  }
  h(I, "toNum");
  function P(i, t) {
    let e = t.buf, r = e[t.pos++], n = (r & 112) >> 4;
    if (r < 128 || (r = e[t.pos++], n |= (r & 127) << 3, r < 128) || (r = e[t.pos++], n |= (r & 127) << 10, r < 128) || (r = e[t.pos++], n |= (r & 127) << 17, r < 128) || (r = e[t.pos++], n |= (r & 127) << 24, r < 128) || (r = e[t.pos++], n |= (r & 1) << 31, r < 128)) return I(i, n);
    throw new Error("Expected varint not more than 10 bytes");
  }
  h(P, "readVarintRemainder");
  function w(i) {
    let t = i.buf, e = t[i.pos++], r = e & 127;
    return e < 128 || (e = t[i.pos++], r |= (e & 127) << 7, e < 128) || (e = t[i.pos++], r |= (e & 127) << 14, e < 128) || (e = t[i.pos++], r |= (e & 127) << 21, e < 128) ? r : (e = t[i.pos], r |= (e & 15) << 28, P(r, i));
  }
  h(w, "readVarint");
  function b2(i, t, e, r, n) {
    return n === 0 ? r !== 0 ? [i - 1 - e, i - 1 - t] : [e, t] : [t, e];
  }
  h(b2, "rotate");
  function C2(i, t, e) {
    if (i > 26) throw new Error("Tile zoom level exceeds max safe number limit (26)");
    if (t >= 1 << i || e >= 1 << i) throw new Error("tile x/y outside zoom level bounds");
    let r = ((1 << i) * (1 << i) - 1) / 3, n = i - 1, [s, a] = [t, e];
    for (let o = 1 << n; o > 0; o >>= 1) {
      let l = s & o, c2 = a & o;
      r += (3 * l ^ c2) * (1 << n), [s, a] = b2(o, s, a, l, c2), n--;
    }
    return r;
  }
  h(C2, "zxyToTileId");
  function R(i) {
    let t = 3 * i + 1;
    return t < 4294967296 ? 31 - Math.clz32(t) : 63 - Math.clz32(t / 4294967296);
  }
  h(R, "tileIdToZ");
  function Z(i) {
    let t = R(i) >> 1;
    if (t > 26) throw new Error("Tile zoom level exceeds max safe number limit (26)");
    let e = ((1 << t) * (1 << t) - 1) / 3, r = i - e, n = 0, s = 0, a = 1 << t;
    for (let o = 1; o < a; o <<= 1) {
      let l = o & r / 2, c2 = o & (r ^ l);
      [n, s] = b2(o, n, s, l, c2), r = r / 2, n += l, s += c2;
    }
    return [t, n, s];
  }
  h(Z, "tileIdToZxy");
  var O2 = ((i) => (i[i.Unknown = 0] = "Unknown", i[i.None = 1] = "None", i[i.Gzip = 2] = "Gzip", i[i.Brotli = 3] = "Brotli", i[i.Zstd = 4] = "Zstd", i))(O2 || {});
  function x(i, t) {
    return g(this, null, function* () {
      if (t === 1 || t === 0) return i;
      if (t === 2) {
        if (typeof globalThis.DecompressionStream > "u") return ut(new Uint8Array(i));
        let e = new Response(i).body;
        if (!e) throw new Error("Failed to read response stream");
        let r = e.pipeThrough(new globalThis.DecompressionStream("gzip"));
        return new Response(r).arrayBuffer();
      }
      throw new Error("Compression method not supported");
    });
  }
  h(x, "defaultDecompress");
  var S2 = ((i) => (i[i.Unknown = 0] = "Unknown", i[i.Mvt = 1] = "Mvt", i[i.Png = 2] = "Png", i[i.Jpeg = 3] = "Jpeg", i[i.Webp = 4] = "Webp", i[i.Avif = 5] = "Avif", i[i.Mlt = 6] = "Mlt", i))(S2 || {});
  function U(i) {
    return i === 1 ? ".mvt" : i === 2 ? ".png" : i === 3 ? ".jpg" : i === 4 ? ".webp" : i === 5 ? ".avif" : i === 6 ? ".mlt" : "";
  }
  h(U, "tileTypeExt");
  var ee = 127;
  function E(i, t) {
    let e = 0, r = i.length - 1;
    for (; e <= r; ) {
      let n = r + e >> 1, s = t - i[n].tileId;
      if (s > 0) e = n + 1;
      else if (s < 0) r = n - 1;
      else return i[n];
    }
    return r >= 0 && (i[r].runLength === 0 || t - i[r].tileId < i[r].runLength) ? i[r] : null;
  }
  h(E, "findTile");
  var B = class {
    constructor(t) {
      this.file = t;
    }
    getKey() {
      return this.file.name;
    }
    getBytes(t, e) {
      return g(this, null, function* () {
        return { data: yield this.file.slice(t, t + e).arrayBuffer() };
      });
    }
  };
  h(B, "FileSource");
  var te = B;
  var j2 = class {
    constructor(t, e = new Headers(), r = void 0) {
      var n, s;
      this.url = t, this.customHeaders = e, this.credentials = r, this.mustReload = false;
      let a = "";
      "navigator" in globalThis && (a = (s = (n = globalThis.navigator) == null ? void 0 : n.userAgent) != null ? s : "");
      let o = a.indexOf("Windows") > -1, l = /Chrome|Chromium|Edg|OPR|Brave/.test(a);
      this.chromeWindowsNoCache = false, o && l && (this.chromeWindowsNoCache = true);
    }
    getKey() {
      return this.url;
    }
    setHeaders(t) {
      this.customHeaders = t;
    }
    getBytes(t, e, r, n) {
      return g(this, null, function* () {
        let s, a;
        r ? a = r : (s = new AbortController(), a = s.signal);
        let o = new Headers(this.customHeaders);
        o.set("range", `bytes=${t}-${t + e - 1}`);
        let l;
        this.mustReload ? l = "reload" : this.chromeWindowsNoCache && (l = "no-store");
        let c2 = yield fetch(this.url, { signal: a, cache: l, headers: o, credentials: this.credentials });
        if (t === 0 && c2.status === 416) {
          let f = c2.headers.get("Content-Range");
          if (!f || !f.startsWith("bytes */")) throw new Error("Missing content-length on 416 response");
          let p = +f.substr(8);
          o.set("range", `bytes=0-${p - 1}`), c2 = yield fetch(this.url, { signal: a, cache: "reload", headers: o, credentials: this.credentials });
        }
        let d2 = c2.headers.get("Etag");
        if (d2 != null && d2.startsWith("W/") && (d2 = null), c2.status === 416 || n && d2 && d2 !== n) throw this.mustReload = true, new T(`Server returned non-matching ETag ${n} after one retry. Check browser extensions and servers for issues that may affect correct ETag headers.`);
        if (c2.status >= 300) throw new Error(`Bad response code: ${c2.status}`);
        let u = c2.headers.get("Content-Length");
        if (c2.status === 200 && (!u || +u > e)) throw s && s.abort(), new Error("Server returned no content-length header or content-length exceeding request. Check that your storage backend supports HTTP Byte Serving.");
        return { data: yield c2.arrayBuffer(), etag: d2 || void 0, cacheControl: c2.headers.get("Cache-Control") || void 0, expires: c2.headers.get("Expires") || void 0 };
      });
    }
  };
  h(j2, "FetchSource");
  var k2 = j2;
  function y(i, t) {
    let e = i.getUint32(t + 4, true), r = i.getUint32(t + 0, true);
    return e * q2(2, 32) + r;
  }
  h(y, "getUint64");
  function M(i, t) {
    let e = new DataView(i), r = e.getUint8(7);
    if (r > 3) throw new Error(`Archive is spec version ${r} but this library supports up to spec version 3`);
    return { specVersion: r, rootDirectoryOffset: y(e, 8), rootDirectoryLength: y(e, 16), jsonMetadataOffset: y(e, 24), jsonMetadataLength: y(e, 32), leafDirectoryOffset: y(e, 40), leafDirectoryLength: y(e, 48), tileDataOffset: y(e, 56), tileDataLength: y(e, 64), numAddressedTiles: y(e, 72), numTileEntries: y(e, 80), numTileContents: y(e, 88), clustered: e.getUint8(96) === 1, internalCompression: e.getUint8(97), tileCompression: e.getUint8(98), tileType: e.getUint8(99), minZoom: e.getUint8(100), maxZoom: e.getUint8(101), minLon: e.getInt32(102, true) / 1e7, minLat: e.getInt32(106, true) / 1e7, maxLon: e.getInt32(110, true) / 1e7, maxLat: e.getInt32(114, true) / 1e7, centerZoom: e.getUint8(118), centerLon: e.getInt32(119, true) / 1e7, centerLat: e.getInt32(123, true) / 1e7, etag: t };
  }
  h(M, "bytesToHeader");
  function A(i) {
    let t = { buf: new Uint8Array(i), pos: 0 }, e = w(t), r = [], n = 0;
    for (let s = 0; s < e; s++) {
      let a = w(t);
      r.push({ tileId: n + a, offset: 0, length: 0, runLength: 1 }), n += a;
    }
    for (let s = 0; s < e; s++) r[s].runLength = w(t);
    for (let s = 0; s < e; s++) r[s].length = w(t);
    for (let s = 0; s < e; s++) {
      let a = w(t);
      a === 0 && s > 0 ? r[s].offset = r[s - 1].offset + r[s - 1].length : r[s].offset = a - 1;
    }
    return r;
  }
  h(A, "deserializeIndex");
  var F = class extends Error {
  };
  h(F, "EtagMismatch");
  var T = F;
  function D(i, t) {
    return g(this, null, function* () {
      let e = yield i.getBytes(0, 16384);
      if (new DataView(e.data).getUint16(0, true) !== 19792) throw new Error("Wrong magic number for PMTiles archive");
      let r = e.data.slice(0, ee), n = M(r, e.etag), s = e.data.slice(n.rootDirectoryOffset, n.rootDirectoryOffset + n.rootDirectoryLength), a = `${i.getKey()}|${n.etag || ""}|${n.rootDirectoryOffset}|${n.rootDirectoryLength}`, o = A(yield t(s, n.internalCompression));
      return [n, [a, o.length, o]];
    });
  }
  h(D, "getHeaderAndRoot");
  function $(i, t, e, r, n, s) {
    return g(this, null, function* () {
      let a = yield i.getBytes(e, r, s, n.etag), o = yield t(a.data, n.internalCompression), l = A(o);
      if (l.length === 0) throw new Error("Empty directory is invalid");
      return l;
    });
  }
  h($, "getDirectory");
  var K = class {
    constructor(t = 100, e = true, r = x) {
      this.cache = /* @__PURE__ */ new Map(), this.maxCacheEntries = t, this.counter = 1, this.decompress = r;
    }
    getHeader(t) {
      return g(this, null, function* () {
        let e = t.getKey(), r = this.cache.get(e);
        if (r) return r.lastUsed = this.counter++, r.data;
        let n = yield D(t, this.decompress);
        return n[1] && this.cache.set(n[1][0], { lastUsed: this.counter++, data: n[1][2] }), this.cache.set(e, { lastUsed: this.counter++, data: n[0] }), this.prune(), n[0];
      });
    }
    getDirectory(t, e, r, n, s) {
      return g(this, null, function* () {
        let a = `${t.getKey()}|${n.etag || ""}|${e}|${r}`, o = this.cache.get(a);
        if (o) return o.lastUsed = this.counter++, o.data;
        let l = yield $(t, this.decompress, e, r, n, s);
        return this.cache.set(a, { lastUsed: this.counter++, data: l }), this.prune(), l;
      });
    }
    prune() {
      if (this.cache.size > this.maxCacheEntries) {
        let t = 1 / 0, e;
        this.cache.forEach((r, n) => {
          r.lastUsed < t && (t = r.lastUsed, e = n);
        }), e && this.cache.delete(e);
      }
    }
    invalidate(t) {
      return g(this, null, function* () {
        this.cache.delete(t.getKey());
      });
    }
  };
  h(K, "ResolvedValueCache");
  var re = K;
  var W = class {
    constructor(t = 100, e = true, r = x) {
      this.cache = /* @__PURE__ */ new Map(), this.invalidations = /* @__PURE__ */ new Map(), this.pendingFetches = /* @__PURE__ */ new Map(), this.maxCacheEntries = t, this.counter = 1, this.decompress = r;
    }
    getHeader(t) {
      return g(this, null, function* () {
        let e = t.getKey(), r = this.cache.get(e);
        if (r) return r.lastUsed = this.counter++, yield r.data;
        let n = new Promise((s, a) => {
          D(t, this.decompress).then((o) => {
            o[1] && this.cache.set(o[1][0], { lastUsed: this.counter++, data: Promise.resolve(o[1][2]) }), s(o[0]), this.prune();
          }).catch((o) => {
            a(o);
          });
        });
        return this.cache.set(e, { lastUsed: this.counter++, data: n }), n;
      });
    }
    trackSignal(t, e, r) {
      e.refs++, r.addEventListener("abort", () => {
        --e.refs <= 0 && this.pendingFetches.get(t) === e && (e.controller.abort(), this.cache.delete(t), this.pendingFetches.delete(t));
      }, { once: true });
    }
    getDirectory(t, e, r, n, s) {
      return g(this, null, function* () {
        let a = `${t.getKey()}|${n.etag || ""}|${e}|${r}`, o = this.cache.get(a);
        if (o) {
          o.lastUsed = this.counter++;
          let u = this.pendingFetches.get(a);
          return u && this.trackSignal(a, u, s ?? new AbortController().signal), yield o.data;
        }
        let l = new AbortController(), c2 = { controller: l, refs: 0 };
        this.trackSignal(a, c2, s ?? new AbortController().signal), this.pendingFetches.set(a, c2);
        let d2 = new Promise((u, f) => {
          $(t, this.decompress, e, r, n, l.signal).then((p) => {
            this.pendingFetches.delete(a), u(p), this.prune();
          }).catch((p) => {
            f(p);
          });
        });
        return this.cache.set(a, { lastUsed: this.counter++, data: d2 }), d2;
      });
    }
    prune() {
      if (this.cache.size >= this.maxCacheEntries) {
        let t = 1 / 0, e;
        this.cache.forEach((r, n) => {
          r.lastUsed < t && (t = r.lastUsed, e = n);
        }), e && this.cache.delete(e);
      }
    }
    invalidate(t) {
      return g(this, null, function* () {
        let e = t.getKey();
        if (this.invalidations.get(e)) return yield this.invalidations.get(e);
        this.cache.delete(t.getKey());
        let r = new Promise((n, s) => {
          this.getHeader(t).then((a) => {
            n(), this.invalidations.delete(e);
          }).catch((a) => {
            s(a);
          });
        });
        this.invalidations.set(e, r);
      });
    }
  };
  h(W, "SharedPromiseCache");
  var V = W;
  var N = class {
    constructor(t, e, r) {
      typeof t == "string" ? this.source = new k2(t) : this.source = t, r ? this.decompress = r : this.decompress = x, e ? this.cache = e : this.cache = new V();
    }
    getHeader() {
      return g(this, null, function* () {
        return yield this.cache.getHeader(this.source);
      });
    }
    getZxyAttempt(t, e, r, n) {
      return g(this, null, function* () {
        let s = C2(t, e, r), a = yield this.cache.getHeader(this.source);
        if (n?.throwIfAborted(), t < a.minZoom || t > a.maxZoom) return;
        let o = a.rootDirectoryOffset, l = a.rootDirectoryLength;
        for (let c2 = 0; c2 <= 3; c2++) {
          let d2 = yield this.cache.getDirectory(this.source, o, l, a, n);
          n?.throwIfAborted();
          let u = E(d2, s);
          if (u) {
            if (u.runLength > 0) {
              let f = yield this.source.getBytes(a.tileDataOffset + u.offset, u.length, n, a.etag);
              return { data: yield this.decompress(f.data, a.tileCompression), cacheControl: f.cacheControl, expires: f.expires };
            }
            o = a.leafDirectoryOffset + u.offset, l = u.length;
          } else return;
        }
        throw new Error("Maximum directory depth exceeded");
      });
    }
    getZxy(t, e, r, n) {
      return g(this, null, function* () {
        try {
          return yield this.getZxyAttempt(t, e, r, n);
        } catch (s) {
          if (s instanceof T) return this.cache.invalidate(this.source), yield this.getZxyAttempt(t, e, r, n);
          throw s;
        }
      });
    }
    getMetadataAttempt() {
      return g(this, null, function* () {
        let t = yield this.cache.getHeader(this.source), e = yield this.source.getBytes(t.jsonMetadataOffset, t.jsonMetadataLength, void 0, t.etag), r = yield this.decompress(e.data, t.internalCompression), n = new TextDecoder("utf-8");
        return JSON.parse(n.decode(r));
      });
    }
    getMetadata() {
      return g(this, null, function* () {
        try {
          return yield this.getMetadataAttempt();
        } catch (t) {
          if (t instanceof T) return this.cache.invalidate(this.source), yield this.getMetadataAttempt();
          throw t;
        }
      });
    }
    getTileJson(t) {
      return g(this, null, function* () {
        let e = yield this.getHeader(), r = yield this.getMetadata(), n = U(e.tileType);
        return { tilejson: "3.0.0", scheme: "xyz", tiles: [`${t}/{z}/{x}/{y}${n}`], vector_layers: r.vector_layers, attribution: r.attribution, description: r.description, name: r.name, version: r.version, bounds: [e.minLon, e.minLat, e.maxLon, e.maxLat], center: [e.centerLon, e.centerLat, e.centerZoom], minzoom: e.minZoom, maxzoom: e.maxZoom };
      });
    }
  };
  h(N, "PMTiles");
  var H = N;
  return __toCommonJS(pmtiles_esm_exports);
})();
