import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  TextInput,
  View,
  Text as NativeText,
} from 'react-native-web';
import {
  forwardRef,
  useLayoutEffect,
  useRef,
  type ComponentProps,
  type ElementRef,
  type MutableRefObject,
  type ReactNode,
  type Ref,
} from 'react';
import { theme, useTheme, type Theme } from '@modules/_shared/ui/theme/AppTheme';

export type BoxProps = ComponentProps<typeof View> & Record<string, unknown>;
export type TextProps = ComponentProps<typeof NativeText> & Record<string, unknown>;

const colors = theme.colors;
const spacing = theme.spacing;

function token(value: unknown): unknown {
  return typeof value === 'string' && value in colors
    ? colors[value as keyof typeof colors]
    : value;
}

type DragProps = {
  draggable?: boolean;
  onDragStart?: (event: DragEvent) => void;
  onDragEnd?: (event: DragEvent) => void;
  onDragEnter?: (event: DragEvent) => void;
  onDragOver?: (event: DragEvent) => void;
  onDragLeave?: (event: DragEvent) => void;
  onDrop?: (event: DragEvent) => void;
};

type DragEventKey = Exclude<keyof DragProps, 'draggable'>;

function useImperativeDomProps(
  className: unknown,
  drag: DragProps,
  forwardedRef: Ref<HTMLElement> | undefined,
) {
  const internalRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;
  const forwardedRefRef = useRef(forwardedRef);
  forwardedRefRef.current = forwardedRef;

  const setRef = useRef((node: HTMLElement | null) => {
    internalRef.current = node;
    const resolvedRef = forwardedRefRef.current;
    if (typeof resolvedRef === 'function') resolvedRef(node);
    else if (resolvedRef) (resolvedRef as MutableRefObject<HTMLElement | null>).current = node;
  }).current;

  useLayoutEffect(() => {
    if (typeof className !== 'string' || !className.trim() || !internalRef.current) return;
    const classes = className.split(/\s+/).filter(Boolean);
    internalRef.current.classList.add(...classes);
    return () => internalRef.current?.classList.remove(...classes);
  }, [className]);

  useLayoutEffect(() => {
    const node = internalRef.current;
    if (!node) return;
    if (drag.draggable) node.setAttribute('draggable', 'true');
    else node.removeAttribute('draggable');
  }, [drag.draggable]);

  useLayoutEffect(() => {
    const node = internalRef.current;
    if (!node) return;
    const entries: Array<[string, DragEventKey]> = [
      ['dragstart', 'onDragStart'],
      ['dragend', 'onDragEnd'],
      ['dragenter', 'onDragEnter'],
      ['dragover', 'onDragOver'],
      ['dragleave', 'onDragLeave'],
      ['drop', 'onDrop'],
    ];
    const bound = entries.map(([type, key]) => {
      const listener = (event: Event) => dragRef.current[key]?.(event as DragEvent);
      node.addEventListener(type, listener);
      return [type, listener] as const;
    });
    return () => bound.forEach(([type, listener]) => node.removeEventListener(type, listener));
  }, []);

  return setRef;
}

export const Box = forwardRef<ElementRef<typeof View>, BoxProps>(function Box(
  {
    children,
    style,
    className,
    draggable,
    onDragStart,
    onDragEnd,
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
    ...props
  },
  forwardedRef,
) {
  const {
    gap,
    padding,
    paddingHorizontal,
    paddingVertical,
    margin,
    marginBottom,
    borderRadius,
    borderColor,
    backgroundColor,
    flex,
    flexDirection,
    flexWrap,
    alignItems,
    justifyContent,
    width,
    height,
    maxWidth,
    maxHeight,
    minHeight,
    alignSelf,
    opacity,
    borderWidth,
    position,
    top,
    right,
    bottom,
    left,
    overflow,
    ...rest
  } = props;
  const setRef = useImperativeDomProps(
    className,
    {
      draggable: draggable as boolean | undefined,
      onDragStart: onDragStart as DragProps['onDragStart'],
      onDragEnd: onDragEnd as DragProps['onDragEnd'],
      onDragEnter: onDragEnter as DragProps['onDragEnter'],
      onDragOver: onDragOver as DragProps['onDragOver'],
      onDragLeave: onDragLeave as DragProps['onDragLeave'],
      onDrop: onDrop as DragProps['onDrop'],
    },
    forwardedRef as Ref<HTMLElement>,
  );
  return (
    <View
      ref={setRef as never}
      {...rest}
      style={[
        {
          gap: spacing[gap as keyof typeof spacing] ?? gap,
          padding: spacing[padding as keyof typeof spacing] ?? padding,
          paddingHorizontal:
            spacing[paddingHorizontal as keyof typeof spacing] ?? paddingHorizontal,
          paddingVertical: spacing[paddingVertical as keyof typeof spacing] ?? paddingVertical,
          margin,
          marginBottom,
          borderRadius:
            typeof borderRadius === 'string' && borderRadius in theme.radii
              ? theme.radii[borderRadius as keyof typeof theme.radii]
              : borderRadius,
          borderColor: token(borderColor),
          backgroundColor: token(backgroundColor),
          flex,
          flexDirection,
          flexWrap,
          alignItems,
          justifyContent,
          width,
          height,
          maxWidth,
          maxHeight,
          minHeight,
          alignSelf,
          opacity,
          borderWidth,
          position,
          top,
          right,
          bottom,
          left,
          overflow,
        },
        style as ComponentProps<typeof View>['style'],
      ]}
    >
      {children as ReactNode}
    </View>
  );
});

export function Text({
  children,
  style,
  color,
  className,
  ...props
}: TextProps & { color?: string }) {
  const { variant, bold, semibold, uppercase, align, ...rest } = props;
  const textVariant = theme.textVariants[variant as keyof typeof theme.textVariants];
  const setRef = useImperativeDomProps(className, {}, undefined);
  return (
    <NativeText
      ref={setRef as never}
      {...rest}
      style={[
        {
          color: token(color) ?? colors.gray120,
          fontFamily: textVariant?.fontFamily,
          fontWeight: bold ? '700' : semibold ? '600' : textVariant?.fontWeight,
          textTransform: uppercase ? 'uppercase' : textVariant?.textTransform,
          textAlign: align,
          fontSize: textVariant?.fontSize,
          lineHeight:
            typeof textVariant?.lineHeight === 'number'
              ? textVariant.lineHeight * textVariant.fontSize
              : undefined,
          letterSpacing: textVariant?.letterSpacing,
        },
        style as ComponentProps<typeof NativeText>['style'],
      ]}
    >
      {children}
    </NativeText>
  );
}

export { Pressable, ScrollView, View, ActivityIndicator, TextInput, colors, theme, useTheme };
export type { Theme };
