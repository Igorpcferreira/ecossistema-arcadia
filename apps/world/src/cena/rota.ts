// A* na grade de ladrilhos (4 vizinhos), com fila de prioridade em heap binário.
export function rota(ni: number, nj: number, bloqueado: Uint8Array, a: [number, number], b: [number, number]): [number, number][] {
  if (a[0] === b[0] && a[1] === b[1]) return [b];
  const N = ni * nj;
  const ini = a[1] * ni + a[0], fim = b[1] * ni + b[0];
  if (ini < 0 || ini >= N || fim < 0 || fim >= N) return [b];
  const custo = new Float32Array(N).fill(Infinity), veio = new Int32Array(N).fill(-1), fechado = new Uint8Array(N);
  const h = (k: number) => Math.abs((k % ni) - b[0]) + Math.abs(Math.floor(k / ni) - b[1]);
  // heap de pares (prioridade, nó)
  const pri: number[] = [], nos: number[] = [];
  const empurra = (p: number, n: number) => {
    pri.push(p); nos.push(n);
    let i = pri.length - 1;
    while (i > 0) { const pai = (i - 1) >> 1; if (pri[pai] <= pri[i]) break; [pri[pai], pri[i]] = [pri[i], pri[pai]]; [nos[pai], nos[i]] = [nos[i], nos[pai]]; i = pai; }
  };
  const tira = (): number => {
    const topo = nos[0];
    const up = pri.pop()!, un = nos.pop()!;
    if (pri.length) {
      pri[0] = up; nos[0] = un;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1; let m = i;
        if (l < pri.length && pri[l] < pri[m]) m = l;
        if (r < pri.length && pri[r] < pri[m]) m = r;
        if (m === i) break;
        [pri[m], pri[i]] = [pri[i], pri[m]]; [nos[m], nos[i]] = [nos[i], nos[m]]; i = m;
      }
    }
    return topo;
  };
  custo[ini] = 0; empurra(h(ini), ini);
  let guarda = 0;
  while (pri.length && guarda++ < 20000) {
    const k = tira();
    if (k === fim) break;
    if (fechado[k]) continue;
    fechado[k] = 1;
    const ki = k % ni, kj = Math.floor(k / ni);
    for (let d = 0; d < 4; d++) {
      const vi = ki + (d === 0 ? 1 : d === 1 ? -1 : 0), vj = kj + (d === 2 ? 1 : d === 3 ? -1 : 0);
      if (vi < 0 || vj < 0 || vi >= ni || vj >= nj) continue;
      const nk = vj * ni + vi;
      if (fechado[nk] || (bloqueado[nk] && nk !== fim)) continue;
      const c = custo[k] + 1;
      if (c < custo[nk]) { custo[nk] = c; veio[nk] = k; empurra(c + h(nk), nk); }
    }
  }
  if (veio[fim] === -1) return [b];
  const out: [number, number][] = [];
  for (let k = fim; k !== ini && k >= 0; k = veio[k]) out.push([k % ni, Math.floor(k / ni)]);
  return out.reverse();
}
