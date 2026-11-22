import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ComponentChildren } from 'preact';
import { Icon, type IconName } from './Icon';
import './Button.css';

interface OwnProps {
  /** primary — главное действие; ghost — обычная кнопка в рамке (по умолчанию); plain — без фона и рамки. */
  variant?: 'primary' | 'ghost' | 'plain';
  icon?: IconName;
  /** Во всю ширину. */
  wide?: boolean;
  class?: string;
  children?: ComponentChildren;
}

/** Кнопка. С `href` — ссылка, которая выглядит как кнопка. Без подписи — квадратная, нужна `aria-label`. */
export type ButtonProps =
  | (OwnProps & Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof OwnProps> & { href?: undefined })
  | (OwnProps & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof OwnProps> & { href: string });

export function Button(props: ButtonProps) {
  const { variant = 'ghost', icon, wide, class: className, children, ...rest } = props;
  const labelled = children != null && children !== false && children !== '';
  const cls = ['btn', `btn--${variant}`, !labelled && 'btn--icon', wide && 'btn--wide', className]
    .filter(Boolean)
    .join(' ');
  const content = (
    <>
      {icon && <Icon name={icon} size={20} />}
      {labelled && <span>{children}</span>}
    </>
  );

  if (rest.href !== undefined) {
    return (
      <a class={cls} {...(rest as AnchorHTMLAttributes<HTMLAnchorElement>)}>
        {content}
      </a>
    );
  }
  return (
    <button type="button" class={cls} {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)}>
      {content}
    </button>
  );
}
