export function openNavigation(lat: number, lon: number) {
  const apple = `https://maps.apple.com/?daddr=${lat},${lon}`;
  const google = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
  const link = /iPad|iPhone|Mac/.test(navigator.userAgent) ? apple : google;
  window.open(link, '_blank', 'noopener');
}

export async function shareDoor(deepLink: string) {
  if (navigator.share) {
    try {
      await navigator.share({ title: 'ClearPath entrance', url: deepLink });
      return true;
    } catch (error) {
      console.warn('Share cancelled or failed', error);
    }
  }
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(deepLink);
  } else {
    const input = document.createElement('input');
    input.value = deepLink;
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    document.body.removeChild(input);
  }
  return false;
}
