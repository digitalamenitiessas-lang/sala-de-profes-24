import type { ReactNode } from 'react'
import { Document, Font, Image, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer'
import { format } from 'date-fns'
import { es } from 'date-fns/locale/es'
import { ROLES } from '@/lib/constants'
import type { AppRole } from '@/types/database'
import type { Liquidacion } from '@/lib/liquidacion/calcular'

// ---------------------------------------------------------------------------
// PDF de la liquidación con la identidad de La Vieja Escuela
// ---------------------------------------------------------------------------
// Logo, verde inglés del logo, crema, espresso y cobre; Playfair Display para
// títulos y Barlow para el texto (las mismas de la app). Resumen general,
// resumen por persona, detalle día por día y firmas de control.
// `assets` es de dónde se leen logo y fuentes: la URL del sitio en producción
// o la carpeta public/ cuando se genera localmente.
// ---------------------------------------------------------------------------

const C = {
  verde: '#00593b',
  verdeSuave: '#e8f2ec',
  crema: '#f7f3ec',
  espresso: '#3d2c24',
  texto: '#5c4a42',
  piedra: '#a39e97',
  linea: '#e6dfd5',
  cobre: '#b0762a',
  cobreSuave: '#fdf6ec',
  rojo: '#b3332f',
  rojoSuave: '#fdeeed',
}

// Por URL se agrega una versión: evita respuestas viejas guardadas en la caché
// de Vercel (las fuentes llegaron a quedar cacheadas como redirección a /login).
const VERSION_ASSETS = '2'
const asset = (assets: string, ruta: string) => `${assets}/${ruta}${assets.startsWith('http') ? `?v=${VERSION_ASSETS}` : ''}`

let fuentesListas = ''
function registrarFuentes(assets: string) {
  if (fuentesListas === assets) return
  Font.register({
    family: 'Barlow',
    fonts: [
      { src: asset(assets, 'fonts/Barlow-Regular.ttf') },
      { src: asset(assets, 'fonts/Barlow-SemiBold.ttf'), fontWeight: 600 },
      { src: asset(assets, 'fonts/Barlow-Bold.ttf'), fontWeight: 700 },
    ],
  })
  Font.register({ family: 'Playfair', src: asset(assets, 'fonts/PlayfairDisplay-Bold.ttf'), fontWeight: 700 })
  Font.registerHyphenationCallback((w) => [w]) // sin cortar palabras con guiones
  fuentesListas = assets
}

const s = StyleSheet.create({
  page: { paddingTop: 34, paddingBottom: 46, paddingHorizontal: 34, fontFamily: 'Barlow', fontSize: 9, color: C.texto, backgroundColor: '#ffffff' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 12, borderBottomWidth: 2, borderBottomColor: C.verde },
  logo: { width: 92 },
  titulo: { fontFamily: 'Playfair', fontWeight: 700, fontSize: 21, color: C.espresso, textAlign: 'right' },
  subtitulo: { fontSize: 10, color: C.verde, fontWeight: 600, textAlign: 'right', marginTop: 2 },
  generado: { fontSize: 7.5, color: C.piedra, textAlign: 'right', marginTop: 2 },
  seccion: { fontFamily: 'Playfair', fontWeight: 700, fontSize: 12.5, color: C.espresso, marginTop: 16, marginBottom: 6 },
  kpis: { flexDirection: 'row', marginTop: 14, gap: 6 },
  kpiTotal: { flex: 1.6, backgroundColor: C.verde, borderRadius: 6, padding: 10 },
  kpi: { flex: 1, backgroundColor: C.crema, borderRadius: 6, padding: 10 },
  kpiEtiqueta: { fontSize: 7, letterSpacing: 0.8, textTransform: 'uppercase' },
  kpiValor: { fontSize: 15, fontWeight: 700, marginTop: 3 },
  aviso: { marginTop: 10, padding: 8, borderRadius: 5, backgroundColor: C.rojoSuave, color: C.rojo, fontSize: 8.5 },
  reglas: { marginTop: 10, padding: 9, borderRadius: 5, backgroundColor: C.crema, fontSize: 8, lineHeight: 1.4 },
  tabla: { borderTopWidth: 1, borderTopColor: C.linea },
  filaHead: { flexDirection: 'row', backgroundColor: C.verde, color: '#ffffff', paddingVertical: 4, paddingHorizontal: 4, fontSize: 7.5, fontWeight: 600 },
  fila: { flexDirection: 'row', paddingVertical: 3.5, paddingHorizontal: 4, borderBottomWidth: 0.5, borderBottomColor: C.linea },
  filaPar: { backgroundColor: '#fbf9f5' },
  filaTotal: { flexDirection: 'row', paddingVertical: 5, paddingHorizontal: 4, backgroundColor: C.verdeSuave, fontWeight: 700, color: C.espresso },
  persona: { marginTop: 14, borderRadius: 6, borderWidth: 1, borderColor: C.linea },
  personaHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: C.crema, paddingVertical: 6, paddingHorizontal: 8, borderTopLeftRadius: 6, borderTopRightRadius: 6 },
  personaNombre: { fontFamily: 'Playfair', fontWeight: 700, fontSize: 11.5, color: C.espresso },
  personaTotal: { fontSize: 12, fontWeight: 700, color: C.verde },
  etiqueta: { fontSize: 6.8, paddingHorizontal: 3, paddingVertical: 1, borderRadius: 2 },
  firmas: { flexDirection: 'row', gap: 40, marginTop: 34 },
  firma: { flex: 1, borderTopWidth: 1, borderTopColor: C.espresso, paddingTop: 4, fontSize: 8, color: C.texto, textAlign: 'center' },
  pie: { position: 'absolute', bottom: 18, left: 34, right: 34, flexDirection: 'row', justifyContent: 'space-between', fontSize: 7, color: C.piedra, borderTopWidth: 0.5, borderTopColor: C.linea, paddingTop: 5 },
})

const money = (n: number) => `$ ${Math.round(n).toLocaleString('es-AR')}`
const horas = (n: number) => `${(Math.round(n * 10) / 10).toLocaleString('es-AR')} h`
const rolLabel = (r: string) => (r === 'mixto' ? 'Mixto' : ROLES[r as AppRole]?.label ?? r)
const dia = (iso: string) => format(new Date(`${iso}T12:00:00`), 'EEE d/MM', { locale: es })
const fechaLarga = (iso: string) => format(new Date(`${iso}T12:00:00`), "d 'de' MMMM yyyy", { locale: es })

function periodoTexto(from: string, to: string) {
  const a = new Date(`${from}T12:00:00`)
  const b = new Date(`${to}T12:00:00`)
  if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) {
    return `Del ${format(a, 'd')} al ${format(b, "d 'de' MMMM 'de' yyyy", { locale: es })}`
  }
  return `Del ${fechaLarga(from)} al ${fechaLarga(to)}`
}

function Col({ w, children, align = 'left', bold, pl }: { w: number | string; children: ReactNode; align?: 'left' | 'right' | 'center'; bold?: boolean; pl?: number }) {
  return <Text style={{ width: w, textAlign: align, fontWeight: bold ? 700 : undefined, paddingLeft: pl }}>{children}</Text>
}

function LiquidacionPDF({ liq, assets, generadoPor }: { liq: Liquidacion; assets: string; generadoPor?: string | null }) {
  const { summary, employees, period, feriados, rates } = liq
  // Hora Argentina: el servidor corre en UTC
  const generado = new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Tucuman', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const periodo = periodoTexto(period.from, period.to)
  const tarifas = rates.filter((r) => r.hourlyRate > 0).sort((a, b) => b.hourlyRate - a.hourlyRate)

  return (
    <Document title={`Liquidación ${period.from} a ${period.to} — La Vieja Escuela · 24 y Maipú`} author="Sala de Profes" creator="Sala de Profes · La Vieja Escuela · 24 y Maipú">
      <Page size="A4" style={s.page} wrap>
        {/* Encabezado */}
        <View style={s.header}>
          {/* eslint-disable-next-line jsx-a11y/alt-text */}
          <Image style={s.logo} src={asset(assets, 'brand/lve-logo.png')} />
          <View>
            <Text style={s.titulo}>Liquidación de haberes</Text>
            <Text style={s.subtitulo}>{periodo}</Text>
            <Text style={s.generado}>Generado el {generado}{generadoPor ? ` por ${generadoPor}` : ''} · Sala de Profes</Text>
          </View>
        </View>

        {/* Resumen */}
        <View style={s.kpis}>
          <View style={s.kpiTotal}>
            <Text style={[s.kpiEtiqueta, { color: '#cfe3d8' }]}>Total a pagar</Text>
            <Text style={[s.kpiValor, { color: '#ffffff', fontSize: 19 }]}>{money(summary.totalPay)}</Text>
          </View>
          <View style={s.kpi}>
            <Text style={[s.kpiEtiqueta, { color: C.piedra }]}>Horas</Text>
            <Text style={[s.kpiValor, { color: C.espresso }]}>{horas(summary.totalHours)}</Text>
          </View>
          <View style={s.kpi}>
            <Text style={[s.kpiEtiqueta, { color: C.piedra }]}>Personas</Text>
            <Text style={[s.kpiValor, { color: C.espresso }]}>{summary.totalEmployees}</Text>
          </View>
          <View style={s.kpi}>
            <Text style={[s.kpiEtiqueta, { color: C.piedra }]}>Jornadas</Text>
            <Text style={[s.kpiValor, { color: C.espresso }]}>{summary.totalDays}</Text>
          </View>
        </View>

        {(summary.diasRevisar > 0 || summary.missingCheckouts > 0) && (
          <View style={s.aviso}>
            <Text>
              {summary.diasRevisar > 0 ? `${summary.diasRevisar} día${summary.diasRevisar !== 1 ? 's' : ''} con turno mal cargado (se pagó lo fichado). ` : ''}
              {summary.missingCheckouts > 0 ? `${summary.missingCheckouts} fichaje${summary.missingCheckouts !== 1 ? 's' : ''} sin salida todavía (no suman horas). ` : ''}
              Están marcados en el detalle.
            </Text>
          </View>
        )}

        <View style={s.reglas}>
          <Text style={{ fontWeight: 700, color: C.espresso }}>Cómo se calcula</Text>
          <Text>
            Se paga desde el inicio del turno (llegar antes no suma) y hasta la salida, sin pasar el fin del turno salvo
            horas extra autorizadas por el encargado. Si el turno estaba mal cargado se paga lo fichado. Cada turno se
            paga con la tarifa de su rol. Licencias y ausencias no suman. Feriados: 50% más.
          </Text>
          <Text style={{ marginTop: 4 }}>
            <Text style={{ fontWeight: 600, color: C.espresso }}>Tarifas por hora: </Text>
            {tarifas.map((r) => `${r.label} ${money(r.hourlyRate)}`).join(' · ')}
          </Text>
          {feriados.length > 0 && (
            <Text style={{ marginTop: 3 }}>
              <Text style={{ fontWeight: 600, color: C.espresso }}>Feriados del período: </Text>
              {feriados.map((f) => `${dia(f.fecha)} (${f.nombre})`).join(' · ')}
            </Text>
          )}
        </View>

        {/* Resumen por persona */}
        <Text style={s.seccion}>Resumen por persona</Text>
        <View style={s.tabla}>
          <View style={s.filaHead} fixed>
            <Col w="26%">Nombre</Col>
            <Col w="14%">Puesto</Col>
            <Col w="7%" align="right">Días</Col>
            <Col w="10%" align="right">Horas</Col>
            <Col w="27%" pl={10}>Detalle por rol</Col>
            <Col w="16%" align="right">A pagar</Col>
          </View>
          {employees.map((e, i) => (
            <View key={e.id} style={[s.fila, i % 2 ? s.filaPar : {}]} wrap={false}>
              <Col w="26%" bold>{`${e.firstName} ${e.lastName}`}</Col>
              <Col w="14%">{rolLabel(e.role)}</Col>
              <Col w="7%" align="right">{e.totalDays}</Col>
              <Col w="10%" align="right">{horas(e.totalHours)}</Col>
              <Col w="27%" pl={10}>{e.byRole.map((r) => `${rolLabel(r.role)} ${horas(r.hours)}`).join(' · ') || '—'}</Col>
              <Col w="16%" align="right" bold>{money(e.totalPay)}</Col>
            </View>
          ))}
          <View style={s.filaTotal}>
            <Col w="47%">Total</Col>
            <Col w="10%" align="right">{horas(summary.totalHours)}</Col>
            <Col w="27%"> </Col>
            <Col w="16%" align="right">{money(summary.totalPay)}</Col>
          </View>
        </View>

        {/* Detalle por persona */}
        <Text style={s.seccion} break>Detalle por persona</Text>
        {employees.map((e) => (
          <View key={e.id} style={s.persona}>
            <View style={s.personaHead} wrap={false}>
              <View>
                <Text style={s.personaNombre}>{`${e.firstName} ${e.lastName}`}</Text>
                <Text style={{ fontSize: 7.5, color: C.piedra }}>
                  {rolLabel(e.role)} · {e.totalDays} día{e.totalDays !== 1 ? 's' : ''} · {horas(e.totalHours)}
                  {e.horasFeriado > 0 ? ` · ${horas(e.horasFeriado)} en feriado` : ''}
                </Text>
              </View>
              <Text style={s.personaTotal}>{money(e.totalPay)}</Text>
            </View>

            {e.days.length > 0 && (
              <View style={{ paddingHorizontal: 6, paddingTop: 4 }}>
                <View style={[s.fila, { borderBottomColor: C.linea, fontSize: 7, fontWeight: 600, color: C.piedra }]}>
                  <Col w="13%">Fecha</Col>
                  <Col w="13%">Rol</Col>
                  <Col w="9%" align="center">Entrada</Col>
                  <Col w="9%" align="center">Salida</Col>
                  <Col w="10%" align="right">Pagas</Col>
                  <Col w="10%" align="right">Fichadas</Col>
                  <Col w="22%" pl={8}>Observaciones</Col>
                  <Col w="14%" align="right">A pagar</Col>
                </View>
                {e.days.map((d) => {
                  const obs = [
                    d.feriado ? `Feriado +50%` : null,
                    d.revisar ? 'Turno mal cargado: se pagó lo fichado' : null,
                    d.clockOutType === 'edited' ? 'Salida autorizada' : null,
                    d.clockOutType === 'auto' ? 'Salida automática' : null,
                    !d.clockOut ? 'Sin salida' : null,
                  ].filter(Boolean).join(' · ')
                  return (
                    <View key={d.date} style={[s.fila, d.revisar ? { backgroundColor: C.rojoSuave } : d.feriado ? { backgroundColor: C.cobreSuave } : {}]} wrap={false}>
                      <Col w="13%">{dia(d.date)}</Col>
                      <Col w="13%">{rolLabel(d.role)}</Col>
                      <Col w="9%" align="center">{d.clockIn}</Col>
                      <Col w="9%" align="center">{d.clockOut ?? '—'}</Col>
                      <Col w="10%" align="right" bold>{d.hours > 0 ? horas(d.hours) : '—'}</Col>
                      <Col w="10%" align="right">{horas(d.hoursFichadas)}</Col>
                      <Text style={{ width: '22%', paddingLeft: 8, fontSize: 7, color: d.revisar ? C.rojo : C.texto }}>{obs}</Text>
                      <Col w="14%" align="right">{money(d.pay)}</Col>
                    </View>
                  )
                })}
              </View>
            )}

            <View style={{ paddingHorizontal: 10, paddingVertical: 6 }} wrap={false}>
              {e.byRole.map((r) => (
                <Text key={r.role} style={{ fontSize: 8 }}>
                  {rolLabel(r.role)}: {horas(r.hours)} × {money(r.hourlyRate)}{e.horasFeriado > 0 ? ' (con feriados +50%)' : ''} = <Text style={{ fontWeight: 700, color: C.espresso }}>{money(r.pay)}</Text>
                </Text>
              ))}
              {e.ausencias.length > 0 && (
                <Text style={{ fontSize: 8, marginTop: 3 }}>
                  <Text style={{ fontWeight: 600, color: C.espresso }}>Sin fichar: </Text>
                  {e.ausencias.map((a) => `${dia(a.fecha)} ${a.etiqueta}${a.nota ? ` (${a.nota})` : ''}`).join(' · ')}
                </Text>
              )}
            </View>
          </View>
        ))}

        {/* Firmas de control */}
        <View style={s.firmas} wrap={false}>
          <Text style={s.firma}>Revisó (encargado/a)</Text>
          <Text style={s.firma}>Aprobó (socio/a)</Text>
          <Text style={s.firma}>Fecha de pago</Text>
        </View>

        <View style={s.pie} fixed>
          <Text>La Vieja Escuela · 24 y Maipú — Liquidación {periodo.toLowerCase()}</Text>
          <Text render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}

export async function liquidacionPDF(liq: Liquidacion, assets: string, generadoPor?: string | null): Promise<Buffer> {
  registrarFuentes(assets)
  return renderToBuffer(<LiquidacionPDF liq={liq} assets={assets} generadoPor={generadoPor} />)
}
