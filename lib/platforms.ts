// Per-site hints: badge, course/lesson titles and caption DOM. Everything falls
// back to the page title and HTML5 text tracks, so unknown sites still work.
// ponytail: selectors are best effort and drift when sites redesign; fix them here.

export interface Platform {
  badge: string;
  course: string;
  lesson: string;
  captions?: string; // selector matching one element per visible caption line
  ccButton?: string; // toggle that must be on before the player renders captions
  ad?: string; // matches while an ad plays, so its captions, frames and audio are skipped
}

// YouTube keeps the previous page (player, title, captions) hidden in the DOM, so only visible elements count.
export const visible = (sel: string) => [...document.querySelectorAll(sel)].filter((e) => e.checkVisibility());
const text = (sel: string) => (visible(sel)[0]?.textContent ?? '').trim();
const first = (...vals: string[]) => vals.find(Boolean) ?? '';

export function detectPlatform(): Platform {
  const host = location.hostname.replace(/^www\./, '');
  const title = document.title.replace(/^\(\d+\+?\)\s*/, '').replace(/\s*[-|–]\s*(YouTube|Udemy|Coursera)\s*$/i, '').trim();

  if (host.endsWith('youtube.com'))
    return {
      badge: 'YouTube',
      course: first(text('ytd-playlist-panel-renderer h3 yt-formatted-string'), text('#owner #channel-name a'), 'YouTube'),
      lesson: first(text('h1.ytd-watch-metadata'), title),
      captions: '#movie_player .ytp-caption-window-container .caption-visual-line', // main player only, not hover previews
      ccButton: '.ytp-subtitles-button',
      ad: '.html5-video-player.ad-showing',
    };
  if (host.endsWith('udemy.com'))
    return {
      badge: 'Udemy',
      course: first(text('[data-purpose="course-header-title"]'), text('header h1'), 'Udemy'),
      lesson: first(text('li[aria-current="true"] [data-purpose="item-title"]'), title),
      captions: '[data-purpose="captions-cue-text"]',
    };
  if (host.endsWith('coursera.org'))
    return {
      badge: 'Coursera',
      course: first(text('[data-e2e="header-course-name"]'), text('nav[aria-label="breadcrumbs"] a'), 'Coursera'),
      lesson: first(text('h1'), title),
    };
  return { badge: host, course: host, lesson: title || host };
}
