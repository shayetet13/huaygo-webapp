const BACKEND_ORIGIN = 'https://huaygo-backend-production.up.railway.app'

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const target = new URL(url.pathname + url.search, BACKEND_ORIGIN)
    return fetch(new Request(target, request))
  },
}
