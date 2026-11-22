import { JSX } from 'solid-js';
import { iconFor, thumbFor } from './icons';

/** A component icon. `color` is the accent (the category color); `nick` is used when the component has no drawing. */
export function Icon(props: { id: string; nick?: string; color?: string; size?: number }): JSX.Element {
  return <svg class="ico" viewBox="0 0 24 24" aria-hidden="true" style={{ '--ic': props.color ?? 'var(--accent)', width: (props.size ?? 20) + 'px', height: (props.size ?? 20) + 'px' }} innerHTML={iconFor(props.id, props.nick)} />;
}
/** A small schematic picture of a template, an example or a benchmark. */
export function Thumb(props: { id: string; color?: string }): JSX.Element {
  return <svg class="ico thumb" viewBox="0 0 48 32" aria-hidden="true" style={{ '--ic': props.color ?? 'var(--accent)' }} innerHTML={thumbFor(props.id)} />;
}
