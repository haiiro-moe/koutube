import playlistHandler from './handlers/playlistHandler.js';
import videoHandler from './handlers/videoHandler.js';
import { Env, PublicCacheEntry } from './types/types.js';
import {
	deleteExpiredCacheEntries,
	getCacheEntry,
	getCountCacheEntries,
	getURLType,
	listCacheEntriesPaginated,
	renderGenericTemplate,
	stripTracking,
	updatePublicCount,
} from './utils.js';
import template from './templates/db_listing.html.js';
import { config, getRandomApiInstance, robots } from './constants.js';
import embedImageHandler from './handlers/embedImageHandler.js';
import channelHandler from './handlers/channelHandler.js';

import { Buffer } from 'node:buffer';

const getCaseInsensitive = (params: URLSearchParams, param: string) => {
	const wanted = param.toLowerCase();
	for (const [key, value] of params.entries()) if (key.toLowerCase() === wanted) return value;
	return null;
};

declare global {
	interface URLSearchParams {
		getCaseInsensitive(param: string): string | null;
	}
}

URLSearchParams.prototype.getCaseInsensitive = function (param) {
	return getCaseInsensitive(this, param);
};

async function withTiming(handler: () => Promise<Response>): Promise<Response> {
	const startTime = performance.now();
	const response = await handler();
	const duration = performance.now() - startTime;
	console.log({request_duration: duration});
	return response;
}

export default {
	async scheduled(event: ScheduledEvent, env: Env) {
		const deleted = await deleteExpiredCacheEntries(env.DB);
		console.log({deleted_cache_entries: deleted, timestamp: new Date().toISOString()});
		await updatePublicCount(env.DB);
	},

	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		return withTiming(async () => {
			if (new URL(request.url).pathname === '/') {
				async function getListing(_request: Request) {
					const page = new URL(_request.url).searchParams.get('page') || '1';
					const { entries, total } = await listCacheEntriesPaginated(env.DB, parseInt(page), 100);

					let obj = entries.map((key: any) => {
						if (typeof key.name !== 'string' || key.name.startsWith('rateLimit:') || key.name.startsWith('api:') || key.name.startsWith('resolvedUrl:')) return;

						try {
							const url = new URL(key.name);
							if (url.searchParams.get('nocache') !== null) return;
							if (url.pathname.startsWith('/api')) return; // skip api entries, they are still in the db just not publicly listed

							const timecode = url.searchParams.get('t') || url.searchParams.get('time_continue');
							const obj: PublicCacheEntry = {
								url: url.href.replace(url.origin, '').replace('/', ''),
								type: getURLType(url),
								timecode: timecode || '',
								expiration: key?.expiration || 0,
								size: url.searchParams.get('size') || '',
								itag: (function () {
									const itag = url.searchParams.get('itag');
									if (itag === '18') return '360p';
									if (itag === '22') return '720p';
									return itag || '';
								})(),
								dearrow: url.searchParams.get('dearrow') !== null ? 'Yes' : '',
								stock: url.searchParams.get('stock') !== null ? 'Yes' : '',
							};

							return obj;
						} catch (e) {
							return;
						}
					});

					obj = obj.filter(Boolean);

					const body = template
						.replace('$CACHE_ENTRIES', () => JSON.stringify(obj).replace(/</g, '\\u003c'))
						.replace('$COUNT_ENTRIES', () => String(total));

					return new Response(body, {
						headers: { 'Content-Type': 'text/html' },
					});
				}

				return getListing(request);
			}

			if (new URL(request.url).pathname === '/robots.txt') {
				return new Response(robots, {
					headers: { 'Content-Type': 'text/plain' },
				});
			}

			if (new URL(request.url).pathname === '/status' || new URL(request.url).pathname === '/api/status') {
				const count = await getCountCacheEntries(env.DB);
				const body = JSON.stringify({ count, status: 'ok' });
				return new Response(body, {
					headers: { 'Content-Type': 'application/json' },
				});
			}

			const MAX_RETRIES = 3;
			const RETRY_DELAY_MS = 1000;

			for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
				config.api_base = getRandomApiInstance();

				if (env.IV_DOMAIN) {
					config.api_base = env.IV_DOMAIN.startsWith('http://') || env.IV_DOMAIN.startsWith('https://')
						? env.IV_DOMAIN.replace(/\/$/, '')
						: 'https://' + env.IV_DOMAIN;
					config.auth = env.IV_AUTH || '';
				} else {
					config.auth = '';
				}

				try {
					const url = stripTracking(request.url);
					const cache = await getCacheEntry(env.DB, url);
					const shouldCache = new URL(request.url).searchParams.getCaseInsensitive('nocache') === null;
					if (cache && shouldCache) {
						console.log({cache_hit_url: url});
						if (cache.headers['Content-Type'] === 'image/png') {
							const binaryData = Buffer.from(cache.response, 'base64');
							return new Response(binaryData, {
								headers: cache.headers,
							});
						}
						return new Response(cache.response, {
							headers: cache.headers,
						});
					}
				} catch (e) {
					console.error('Cache error', e);
				}

				const urlObj = new URL(request.url);
				const isApi = urlObj.pathname.startsWith('/api');

				// if subdomain is img, embedImageHandler
				if ((urlObj.pathname.startsWith('/img/') || (isApi && urlObj.pathname.startsWith('/api/img/'))) && config.enableImageEmbeds) {
					return embedImageHandler.handleEmbedImage(request, env, isApi, ctx);
				}

				// if we fetch oembed, get all params and return them as json
				if (request.url.includes('oembed.json')) {
					let params: { [key: string]: string } = {};

					// get all params
					new URL(request.url).searchParams.forEach((value, key) => {
						params[key] = value;
					});

					// return them as json
					return new Response(JSON.stringify(params), {
						headers: {
							'Content-Type': 'application/json',
						},
					});
				}

				let originalPath = request.url.replace(new URL(request.url).origin, '');
				if (isApi && originalPath.startsWith('/api')) {
					originalPath = originalPath.substring(4);
				}

				const isPlaylist = originalPath.startsWith('/playlist');
				const isChannel =
					originalPath.startsWith('/channel') ||
					originalPath.startsWith('/c/') ||
					originalPath.startsWith('/@') ||
					originalPath.startsWith('/user/');

				try {
					let result;
					if (isPlaylist) {
						result = await playlistHandler.handlePlaylist(request, env, isApi, ctx);
					} else if (isChannel) {
						result = await channelHandler.handleChannel(request, env, isApi, ctx);
					} else {
						result = await videoHandler.handleVideo(request, env, isApi, ctx);
					}
					return result;
				} catch (e) {
					if ((e as Error).message === 'Invidious seems to have died' && attempt < MAX_RETRIES - 1) {
						console.log({retry_attempt: attempt + 1});
						await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
						continue;
					} else {
						console.error('Error', e);
						let errorMessage = 'Could not fetch. This response was not cached';

						if ((e as Error).message === 'Invidious seems to have died')
							errorMessage =
								'Invidious returned an error indicating that YouTube is fighting unofficial access to their API. This response was not cached.';

						if (isApi) {
							return new Response(JSON.stringify({ error: errorMessage }), {
								status: 200,
								headers: { 'Content-Type': 'application/json' },
							});
						}

						const template = renderGenericTemplate(errorMessage, config.appLink, request, 'Error');
						return new Response(template, {
							status: 200,
							headers: {
								'Content-Type': 'text/html',
							},
						});
					}
				}
			}

			const errorMessage = 'Could not fetch after several retries. This response was not cached.';
			const errorTemplate = renderGenericTemplate(errorMessage, config.appLink, request, 'Error');
			return new Response(errorTemplate, {
				status: 200,
				headers: {
					'Content-Type': 'text/html',
				},
			});
		});
	},
};
