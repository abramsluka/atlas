// Streamed instantly on cold loads + navigation while the server component's
// awaits (auth → timezone → checkin) resolve. Without this the browser sits
// white until the full server response arrives. Kept minimal and dark so it
// blends into the app shell rather than flashing.
export default function Loading() {
  return (
    <div
      className="fixed inset-0 z-[1] flex items-center justify-center"
      style={{ background: '#050508' }}
    >
      <div className="h-6 w-6 rounded-full border-2 border-white/10 border-t-green-400/70 animate-spin" />
    </div>
  )
}
