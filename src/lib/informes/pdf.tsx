import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer'
import { format } from 'date-fns'
import { es } from 'date-fns/locale/es'
import { C, asset, registrarFuentes } from '@/lib/liquidacion/pdf'
import type { Informe } from '@/lib/informes/esquema'

// ---------------------------------------------------------------------------
// PDF de un informe de La Vieja, con la identidad de La Vieja Escuela
// ---------------------------------------------------------------------------
// Traído de Santa Fe (81c0905). Mismo diseño que la liquidación: logo, verde
// del logo, crema y espresso; Playfair para títulos y Barlow para el texto.
// Indicadores, resumen, secciones con texto, puntos y tablas, y notas. El pie
// aclara que es de la 24 y que lo armó la IA con los datos de la app, para que
// se lea con ese cuidado.
// ---------------------------------------------------------------------------

const s = StyleSheet.create({
  page: { paddingTop: 34, paddingBottom: 50, paddingHorizontal: 36, fontFamily: 'Barlow', fontSize: 9.5, color: C.texto, backgroundColor: '#ffffff' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 12, borderBottomWidth: 2, borderBottomColor: C.verde },
  logo: { width: 92 },
  cabeceraTexto: { maxWidth: 360 },
  titulo: { fontFamily: 'Playfair', fontWeight: 700, fontSize: 19, color: C.espresso, textAlign: 'right', lineHeight: 1.2 },
  subtitulo: { fontSize: 10, color: C.verde, fontWeight: 600, textAlign: 'right', marginTop: 3 },
  generado: { fontSize: 7.5, color: C.piedra, textAlign: 'right', marginTop: 3 },
  kpis: { flexDirection: 'row', marginTop: 14, gap: 6 },
  kpiPrimero: { flex: 1, backgroundColor: C.verde, borderRadius: 6, padding: 9 },
  kpi: { flex: 1, backgroundColor: C.crema, borderRadius: 6, padding: 9 },
  kpiEtiqueta: { fontSize: 6.8, letterSpacing: 0.7, textTransform: 'uppercase' },
  kpiValor: { fontSize: 14, fontWeight: 700, marginTop: 3 },
  kpiDetalle: { fontSize: 7, marginTop: 2 },
  // El interlineado va en cada bloque y no en la página: con lineHeight en la página,
  // react-pdf 4.9 deja de dibujar el pie fijo (probado)
  resumen: { lineHeight: 1.4, marginTop: 12, padding: 10, borderRadius: 6, backgroundColor: C.crema, fontSize: 9.5, color: C.espresso },
  seccion: { fontFamily: 'Playfair', fontWeight: 700, fontSize: 12.5, color: C.espresso, marginTop: 16, marginBottom: 5 },
  parrafo: { marginBottom: 4, lineHeight: 1.4 },
  punto: { flexDirection: 'row', marginBottom: 2.5, paddingLeft: 2, lineHeight: 1.4 },
  vineta: { width: 10, color: C.verde, fontWeight: 700 },
  tabla: { marginTop: 4, borderTopWidth: 1, borderTopColor: C.linea },
  filaHead: { flexDirection: 'row', backgroundColor: C.verde, color: '#ffffff', paddingVertical: 4, paddingHorizontal: 4, fontSize: 7.8, fontWeight: 600 },
  fila: { flexDirection: 'row', paddingVertical: 3.5, paddingHorizontal: 4, borderBottomWidth: 0.5, borderBottomColor: C.linea, fontSize: 8.5 },
  filaPar: { backgroundColor: '#fbf9f5' },
  filaTotal: { flexDirection: 'row', paddingVertical: 5, paddingHorizontal: 4, backgroundColor: C.verdeSuave, fontWeight: 700, color: C.espresso, fontSize: 8.5 },
  notas: { lineHeight: 1.4, marginTop: 16, padding: 9, borderRadius: 6, backgroundColor: C.cobreSuave, fontSize: 8.5, color: C.espresso },
  notasTitulo: { fontWeight: 700, color: C.cobre, marginBottom: 3 },
  pie: { position: 'absolute', bottom: 20, left: 36, right: 36, flexDirection: 'row', justifyContent: 'space-between', fontSize: 7, color: C.piedra, borderTopWidth: 0.5, borderTopColor: C.linea, paddingTop: 5 },
})

/** Una columna va a la derecha si todas sus celdas son números, montos o porcentajes */
const esNumerica = (filas: string[][], i: number) =>
  filas.length > 0 && filas.every((f) => f[i] == null || f[i] === '' || /^[\s$+\-−]*[\d.,]+\s*(%|kg|g|l|ml|u|h)?$/i.test(String(f[i]).trim()))

function Tabla({ t }: { t: NonNullable<Informe['secciones'][number]['tabla']> }) {
  const filas = t.filas.map((f) => f.map(String))
  const der = t.columnas.map((_, i) => esNumerica(filas, i))
  // La primera columna (el nombre) se lleva más lugar
  const ancho = (i: number) => (i === 0 ? 2 : 1)
  const celda = (v: string | undefined, i: number) => (
    <Text key={i} style={{ flex: ancho(i), textAlign: der[i] ? 'right' : 'left', paddingRight: 4, paddingLeft: i > 0 && !der[i] ? 8 : 0 }}>{v ?? ''}</Text>
  )
  return (
    <View style={s.tabla}>
      <View style={s.filaHead} fixed>{t.columnas.map((c, i) => celda(c, i))}</View>
      {filas.map((f, n) => (
        <View key={n} style={[s.fila, n % 2 ? s.filaPar : {}]} wrap={false}>{t.columnas.map((_, i) => celda(f[i], i))}</View>
      ))}
      {t.total && <View style={s.filaTotal} wrap={false}>{t.columnas.map((_, i) => celda(t.total?.[i] == null ? '' : String(t.total[i]), i))}</View>}
    </View>
  )
}

function Documento({ inf, assets, para }: { inf: Informe; assets: string; para: string | null }) {
  const ahora = new Date()
  // Hora Argentina: el servidor corre en UTC
  const cuando = format(new Date(ahora.toLocaleString('en-US', { timeZone: 'America/Argentina/Tucuman' })), "d 'de' MMMM yyyy, HH:mm", { locale: es })
  return (
    <Document title={`${inf.titulo} — La Vieja Escuela · 24 y Maipú`} author="La Vieja Escuela" creator="Sala de Profes · La Vieja Escuela · 24 y Maipú">
      <Page size="A4" style={s.page}>
        {/* El pie se dibuja entero con render (un Text suelto con totalPages dentro de una fila no sale) */}
        <View
          style={s.pie}
          fixed
          // El tipo de View no declara totalPages, pero react-pdf lo pasa (probado)
          render={(p) => {
            const { pageNumber, totalPages } = p as unknown as { pageNumber: number; totalPages: number }
            return (
            <>
              <Text style={{ flex: 1 }}>La Vieja Escuela · 24 y Maipú — informe armado por La Vieja (IA) con los datos de la app: revisá lo importante</Text>
              <Text style={{ marginLeft: 8 }}>{`${pageNumber} / ${totalPages}`}</Text>
            </>
            )
          }}
        />

        <View style={s.header} fixed>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- Image de react-pdf no tiene alt */}
          <Image style={s.logo} src={asset(assets, 'brand/lve-logo.png')} />
          <View style={s.cabeceraTexto}>
            <Text style={s.titulo}>{inf.titulo}</Text>
            {inf.subtitulo && <Text style={s.subtitulo}>{inf.subtitulo}</Text>}
            <Text style={s.generado}>Generado el {cuando}{para ? ` · para ${para}` : ''}</Text>
          </View>
        </View>

        {inf.indicadores?.length ? (
          <View style={s.kpis}>
            {inf.indicadores.map((k, i) => (
              <View key={i} style={i === 0 ? s.kpiPrimero : s.kpi}>
                <Text style={[s.kpiEtiqueta, { color: i === 0 ? '#d8ebe1' : C.piedra }]}>{k.etiqueta}</Text>
                <Text style={[s.kpiValor, { color: i === 0 ? '#ffffff' : C.espresso }]}>{k.valor}</Text>
                {k.detalle && <Text style={[s.kpiDetalle, { color: i === 0 ? '#d8ebe1' : C.texto }]}>{k.detalle}</Text>}
              </View>
            ))}
          </View>
        ) : null}

        {inf.resumen && <View style={s.resumen}><Text>{inf.resumen}</Text></View>}

        {inf.secciones.map((sec, i) => (
          <View key={i}>
            <Text style={s.seccion} minPresenceAhead={40}>{sec.titulo}</Text>
            {sec.texto?.split(/\n{2,}/).map((p, j) => <Text key={j} style={s.parrafo}>{p}</Text>)}
            {sec.puntos?.map((p, j) => (
              <View key={j} style={s.punto} wrap={false}><Text style={s.vineta}>•</Text><Text style={{ flex: 1 }}>{p}</Text></View>
            ))}
            {sec.tabla && <Tabla t={sec.tabla} />}
          </View>
        ))}

        {inf.notas?.length ? (
          <View style={s.notas} wrap={false}>
            <Text style={s.notasTitulo}>Para tener en cuenta</Text>
            {inf.notas.map((n, i) => <Text key={i}>• {n}</Text>)}
          </View>
        ) : null}

      </Page>
    </Document>
  )
}

/** `assets`: de dónde leer logo y fuentes (la URL del sitio, o la carpeta public/ en local). */
export async function informePDF(inf: Informe, assets: string, para: string | null): Promise<Buffer> {
  registrarFuentes(assets)
  return renderToBuffer(<Documento inf={inf} assets={assets} para={para} />)
}

/** Nombre de archivo seguro a partir del título */
export const nombreArchivo = (titulo: string) =>
  `${titulo.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w\s.-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Informe'} - LVE 24.pdf`
