/**
 * Cloudflare Worker — Proxy for AIChatTree auto-naming
 *
 * Forwards requests to SiliconFlow API, injecting the API key
 * stored in environment variable SILICONFLOW_API_KEY.
 *
 * Deploy:
 *   1. npx wrangler init aichattree-api
 *   2. Replace src/index.js with this file
 *   3. wrangler secret put SILICONFLOW_API_KEY
 *   4. wrangler deploy
 */

const SILICONFLOW_API = 'https://api.siliconflow.cn/v1/chat/completions';

// Allowed origins (update with your extension ID after first install)
const ALLOWED_ORIGINS = [
    'chrome-extension://', // matches any Chrome extension
];

export default {
    async fetch(request, env) {
        // CORS preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, {
                headers: corsHeaders(request),
            });
        }

        // Only allow POST
        if (request.method !== 'POST') {
            return jsonError('Method not allowed', 405);
        }

        // Basic origin check: allow Chrome extensions
        const origin = request.headers.get('Origin') || '';
        const isExtension = origin.startsWith('chrome-extension://');
        if (!isExtension) {
            return jsonError('Forbidden: only Chrome extension requests allowed', 403);
        }

        // Parse and validate request body
        let body;
        try {
            body = await request.json();
        } catch {
            return jsonError('Invalid JSON body', 400);
        }

        // Safety: cap max_tokens to prevent abuse
        if (!body.max_tokens || body.max_tokens > 50) {
            body.max_tokens = 50;
        }

        // Forward to SiliconFlow
        try {
            const response = await fetch(SILICONFLOW_API, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${env.SILICONFLOW_API_KEY}`,
                },
                body: JSON.stringify(body),
            });

            // Return the API response as-is (including 429 status)
            const responseBody = await response.text();
            return new Response(responseBody, {
                status: response.status,
                headers: {
                    'Content-Type': 'application/json',
                    ...corsHeaders(request),
                },
            });
        } catch (e) {
            return jsonError(`Proxy error: ${e.message}`, 502);
        }
    },
};

function corsHeaders(request) {
    return {
        'Access-Control-Allow-Origin': request.headers.get('Origin') || '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
    };
}

function jsonError(message, status) {
    return new Response(JSON.stringify({ error: { message } }), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}
