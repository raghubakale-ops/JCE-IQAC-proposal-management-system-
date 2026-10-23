import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

export const PALETTE = ['#0e2340', '#0f8b8d', '#2563eb', '#f59e0b', '#16a34a', '#dc2626', '#7c3aed', '#64748b', '#0891b2', '#be185d']
export type Datum = { name: string; value: number }

export function Donut({ data }: { data: Datum[] }) {
  const d = data.filter((x) => x.value > 0)
  return (
    <div className="chartbox" role="img" aria-label={'Distribution: ' + d.map((x) => `${x.name} ${x.value}`).join(', ')}>
      <ResponsiveContainer><PieChart><Pie data={d} dataKey="value" nameKey="name" innerRadius="52%" outerRadius="80%" paddingAngle={2}>
        {d.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}</Pie><Tooltip /><Legend /></PieChart></ResponsiveContainer>
    </div>
  )
}
export function Bars({ data, color = '#0f8b8d', horizontal }: { data: Datum[]; color?: string; horizontal?: boolean }) {
  return (
    <div className="chartbox" role="img" aria-label={'Chart: ' + data.map((x) => `${x.name} ${x.value}`).join(', ')}>
      <ResponsiveContainer><BarChart data={data} layout={horizontal ? 'vertical' : 'horizontal'} margin={{ left: horizontal ? 40 : 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={!horizontal} horizontal={horizontal ? false : true} />
        {horizontal ? <><XAxis type="number" allowDecimals={false} /><YAxis type="category" dataKey="name" width={110} /></> : <><XAxis dataKey="name" /><YAxis allowDecimals={false} /></>}
        <Tooltip /><Bar dataKey="value" fill={color} radius={4} /></BarChart></ResponsiveContainer>
    </div>
  )
}
export function Trend({ data }: { data: Datum[] }) {
  return (
    <div className="chartbox" role="img" aria-label={'Monthly trend: ' + data.map((x) => `${x.name} ${x.value}`).join(', ')}>
      <ResponsiveContainer><LineChart data={data}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" /><YAxis allowDecimals={false} />
        <Tooltip /><Line type="monotone" dataKey="value" stroke="#0f8b8d" strokeWidth={2} dot /></LineChart></ResponsiveContainer>
    </div>
  )
}
