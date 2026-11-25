'use client'

import { AlertTriangle, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { corta, DC, dow } from '@/lib/horneado/fechas'
import { alertasHorneado, type BalanceDia, type ControlHorneado } from '@/lib/horneado/config'

// ---------------------------------------------------------------------------
// Horneado → Control (encargados y socios): lo horneado contra lo que salió
// según Fudo. Traído de Santa Fe (Marco, TabHorneado del control interno).
// ---------------------------------------------------------------------------
// Por día: horneadas + lo que sobró el día anterior = vendidas (sueltas, en el
// Clásico, PedidosYa) + al budín de pan + tiradas + lo que sobró. Lo que no
// cierra es la diferencia: si faltan, no tienen explicación; si sobran, se
// vendieron más de las cargadas (alguna tanda no se cargó).
// ---------------------------------------------------------------------------

const ORDEN_SEMANA = [1, 2, 3, 4, 5, 6, 0]

function Diferencia({ d, umbral }: { d: BalanceDia; umbral: number }) {
  if (d.antesDelControl) return <span className="text-[#a39e97]">—</span>
  if (d.sinTandas) return <span className="font-semibold text-[#9a6418]">sin tandas</span>
  if (d.diferencia > umbral) return <span className="font-bold text-[#c8312c]">faltan {d.diferencia}</span>
  if (d.diferencia < -umbral) return <span className="font-semibold text-[#9a6418]">+{-d.diferencia} sin cargar</span>
  if (d.diferencia === 0) return <span className="text-[#006d5a]">cierra</span>
  // Diferencias chicas (menos que el umbral): se muestran sin alarma
  return <span className="text-[#7d6c64]">{d.diferencia > 0 ? `faltan ${d.diferencia}` : `+${-d.diferencia} sin cargar`}</span>
}

export function ControlHorneadoPanel({ datos, cargando, error }: { datos: ControlHorneado | undefined; cargando: boolean; error: string | null }) {
  if (cargando && !datos) return <p className="flex items-center gap-2 text-[12px] text-[#a39e97]"><Loader2 className="size-3.5 animate-spin" /> Cruzando con las ventas de Fudo…</p>
  if (error && !datos) return <p className="rounded-xl bg-[#fef2f2] px-3 py-2.5 text-[12px] text-[#c8312c]">{error}</p>
  if (!datos) return null

  const ultimos7 = (dias: BalanceDia[]) => dias.slice(-7)
  const budin7 = ultimos7(datos.piezas[0]?.dias ?? []).reduce((a, d) => a + (datos.budinVendido[d.fecha] ?? 0), 0)
  const alBudin7 = datos.piezas.reduce((a, p) => a + ultimos7(p.dias).reduce((x, d) => x + d.budin, 0), 0)
  const alertas = alertasHorneado(datos)

  return (
    <div className="space-y-3">
      <p className="text-[12px] leading-snug text-[#7d6c64]">
        Lo que se horneó (lo carga el equipo en la pestaña <b>Hoy</b>) contra lo que salió según Fudo: sueltas, dentro del Clásico y PedidosYa. Hasta ayer, que ya está completo.
      </p>
      {datos.falta_migracion && (
        <p className="rounded-xl bg-[#fef2f2] px-3 py-2.5 text-[12px] font-semibold text-[#ea504c]">Falta correr la migración del horneado (20261125_horneado.sql).</p>
      )}
      {!datos.falta_migracion && !datos.inicio && (
        <p className="rounded-xl bg-[#f3efe9] px-3 py-2.5 text-[12px] text-[#7d6c64]">Todavía no se cargó ninguna tanda. El control arranca el día siguiente al primero que se cargue; mientras tanto se ve lo que salió y cuántas conviene hornear.</p>
      )}
      {alertas.length > 0 && (
        <ul className="space-y-1.5">
          {alertas.map((a) => (
            <li key={a.texto} className={cn('flex items-start gap-2 rounded-xl px-3 py-2 text-[12px] font-semibold', a.nivel === 'rojo' ? 'bg-[#fef2f2] text-[#c8312c]' : 'bg-[#fdf6ec] text-[#9a6418]')}>
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {a.texto}
            </li>
          ))}
        </ul>
      )}

      {datos.piezas.map((p) => {
        const dias = ultimos7(p.dias)
        const t = dias.reduce((a, d) => ({
          horneadas: a.horneadas + d.horneadas,
          salieron: a.salieron + d.vendidas + d.personal,
          personal: a.personal + d.personal,
          budin: a.budin + d.budin,
          tirado: a.tirado + d.tirado,
          faltan: a.faltan + (d.sinTandas || d.antesDelControl ? 0 : Math.max(0, d.diferencia)),
        }), { horneadas: 0, salieron: 0, personal: 0, budin: 0, tirado: 0, faltan: 0 })
        const sinCargar = dias.filter((d) => d.sinTandas).length
        return (
          <section key={p.pieza} className="space-y-2.5 rounded-2xl bg-white p-3.5 ring-1 ring-[#ebe6df]">
            <div>
              <p className="text-[14px] font-bold text-[#3d2c24]">{p.nombre}</p>
              <p className="text-[11.5px] leading-snug text-[#7d6c64]">
                Últimos 7 días: horneadas <b>{t.horneadas}</b> · salieron <b>{t.salieron}</b>{t.personal > 0 && <> ({t.personal} del personal)</>} · al budín <b>{t.budin}</b> · tiradas <b>{t.tirado}</b>
                {t.faltan > 0 && <> · <b className="text-[#c8312c]">{t.faltan} sin explicar</b></>}
                {sinCargar > 0 && <> · <b className="text-[#9a6418]">{sinCargar} día{sinCargar === 1 ? '' : 's'} sin cargar tandas</b></>}
              </p>
            </div>

            {dias.every((d) => d.horneadas === 0 && d.vendidas + d.personal === 0) ? (
              <p className="rounded-xl bg-[#faf8f5] px-3 py-2.5 text-[12px] text-[#a39e97]">Sin datos todavía.</p>
            ) : (
              <div className="-mx-1 overflow-x-auto">
                <table className="w-full min-w-[22rem] text-[11.5px]">
                  <thead>
                    <tr className="text-[9.5px] font-semibold uppercase tracking-wide text-[#a39e97]">
                      <th className="px-1 pb-1 text-left">Día</th>
                      <th className="px-1 pb-1 text-right">Horn.</th>
                      <th className="px-1 pb-1 text-right">Salieron</th>
                      <th className="px-1 pb-1 text-right">Sobró</th>
                      <th className="px-1 pb-1 text-right">Budín</th>
                      <th className="px-1 pb-1 text-right">Tiró</th>
                      <th className="px-1 pb-1 text-right">Cierre</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...dias].reverse().map((d) => (
                      <tr key={d.fecha} className={cn('border-t border-[#f3efe9]', !d.sinTandas && !d.antesDelControl && d.diferencia > p.umbral && 'bg-[#fff7f6]')}>
                        <td className="px-1 py-1.5 text-[#3d2c24]">{DC[dow(d.fecha)]} {corta(d.fecha)}</td>
                        <td className="px-1 py-1.5 text-right tabular-nums">{d.horneadas}</td>
                        <td className="px-1 py-1.5 text-right tabular-nums" title={d.personal > 0 ? `${d.vendidas} vendidas + ${d.personal} del personal` : `${d.vendidas} vendidas`}>{d.vendidas + d.personal}</td>
                        <td className={cn('px-1 py-1.5 text-right tabular-nums', d.sinConteo && 'text-[#a39e97]')}>{d.sobrante ?? '—'}</td>
                        <td className="px-1 py-1.5 text-right tabular-nums">{d.budin || ''}</td>
                        <td className="px-1 py-1.5 text-right tabular-nums">{d.tirado || ''}</td>
                        <td className="px-1 py-1.5 text-right tabular-nums"><Diferencia d={d} umbral={p.umbral} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <p className="text-[11px] text-[#7d6c64]">
              Conviene hornear por día:{' '}
              {ORDEN_SEMANA.map((dw) => `${DC[dw]} ${p.recomendadoSemana[dw]?.total ?? '—'}`).join(' · ')}
            </p>
          </section>
        )
      })}

      <p className="rounded-xl bg-[#f3efe9] px-3 py-2 text-[11.5px] leading-snug text-[#7d6c64]">
        Budín de pan en los últimos 7 días: <b>{budin7}</b> porciones vendidas (sueltas y como postre de los menús) y <b>{alBudin7}</b> piezas cargadas como «al budín». Si se carga mucho al budín pero casi no se vende, lo que sobra no está yendo ahí.
      </p>
      <p className="text-[10.5px] leading-snug text-[#a39e97]">
        Cierre: horneadas + lo que sobró el día anterior, menos lo que salió, fue al budín, se tiró y sobró. «Faltan» son piezas sin explicación; «sin cargar», que se vendieron más de las cargadas (alguna tanda no se anotó).
      </p>
    </div>
  )
}
