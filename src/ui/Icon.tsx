import { JSX } from 'solid-js';
import { iconFor, iconUri, thumbFor } from './icons';
import { ui } from './store';

/** A component icon. `color` is the accent (the category color); `nick` is used when the component has no drawing. */
export function Icon(props: { id: string; nick?: string; color?: string; size?: number }): JSX.Element {
  return <svg class="ico" viewBox="0 0 24 24" aria-hidden="true" style={{ '--ic': props.color ?? 'var(--accent)', width: (props.size ?? 20) + 'px', height: (props.size ?? 20) + 'px' }} innerHTML={iconFor(props.id, props.nick)} />;
}
/** A small schematic picture of a template, an example or a benchmark. */
export function Thumb(props: { id: string; color?: string }): JSX.Element {
  return <svg class="ico thumb" viewBox="0 0 48 32" aria-hidden="true" style={{ '--ic': props.color ?? 'var(--accent)' }} innerHTML={thumbFor(props.id)} />;
}
/**
 * The same icon as an image, for the canvas, where there can be hundreds of them. The picture is drawn
 * with a one-unit margin (so strokes at the edge are not clipped), which the size allows for.
 */
export function IconImg(props: { id: string; nick?: string; color?: string; size?: number }): JSX.Element {
  const px = () => Math.round((props.size ?? 20) * 26 / 24);
  return <img class="ico-img" alt="" draggable={false} width={px()} height={px()} src={iconUri(props.id, props.nick ?? '', props.color ?? '#2f6fd6', ui.theme === 'dark' ? '#d5dae1' : '#3b4450')} />;
}
