/**
 * `react-native-web` ships no TypeScript declarations of its own, and the
 * `@types/react-native-web` package on npm re-exports `@types/react-native`
 * (not installed, and not applicable — this app is web-only, never native).
 * This declares only the named exports this codebase actually imports,
 * typed against react-native-web's real (web) prop surface — including its
 * React Native compat props (`keyboardType`, `numberOfLines`, ...) — so
 * `strict`/`noImplicitAny` stays meaningful for consumers instead of
 * silently falling back to `any` on the whole module.
 *
 * Event handler parameters are intentionally `any`, matching
 * react-native-web's own (untyped) runtime signatures — RNW does not
 * synthesize React's `SyntheticEvent` shapes, so typing these narrowly
 * would reject valid handlers rather than catch real mistakes.
 */
declare module 'react-native-web' {
  import type { ComponentType, ForwardRefExoticComponent, ReactNode, RefAttributes } from 'react';

  type StyleValue<T> = T | false | null | undefined;
  type StyleProp<T> = StyleValue<T> | ReadonlyArray<StyleProp<T>>;

  interface EventProps {
    onClick?: (event: any) => void;
    onFocus?: (event: any) => void;
    onBlur?: (event: any) => void;
    onKeyDown?: (event: any) => void;
    onKeyUp?: (event: any) => void;
    onMouseDown?: (event: any) => void;
    onMouseEnter?: (event: any) => void;
    onMouseLeave?: (event: any) => void;
    onMouseMove?: (event: any) => void;
    onPointerDown?: (event: any) => void;
    onPointerUp?: (event: any) => void;
    onTouchStart?: (event: any) => void;
    onTouchEnd?: (event: any) => void;
    onScroll?: (event: any) => void;
    onWheel?: (event: any) => void;
  }

  export interface ViewProps extends EventProps {
    children?: ReactNode;
    style?: StyleProp<Record<string, unknown>>;
    testID?: string;
    id?: string;
    nativeID?: string;
    accessibilityLabel?: string;
    accessibilityRole?: string;
    pointerEvents?: 'box-none' | 'none' | 'box-only' | 'auto';
  }
  export const View: ForwardRefExoticComponent<ViewProps & RefAttributes<HTMLElement>>;

  export interface ActivityIndicatorProps extends ViewProps {
    animating?: boolean;
    color?: string;
    hidesWhenStopped?: boolean;
    size?: 'small' | 'large' | number;
  }
  export const ActivityIndicator: ForwardRefExoticComponent<
    ActivityIndicatorProps & RefAttributes<HTMLElement>
  >;

  export interface TextProps extends Omit<ViewProps, 'style'> {
    style?: StyleProp<Record<string, unknown>>;
    numberOfLines?: number;
    selectable?: boolean;
    onPress?: (event: any) => void;
  }
  export const Text: ForwardRefExoticComponent<TextProps & RefAttributes<HTMLElement>>;

  export interface PressableStateCallback {
    pressed: boolean;
    hovered?: boolean;
    focused?: boolean;
  }
  export interface PressableProps extends Omit<ViewProps, 'style' | 'children'> {
    children?: ReactNode | ((state: PressableStateCallback) => ReactNode);
    disabled?: boolean;
    onPress?: (event: any) => void;
    onPressIn?: (event: any) => void;
    onPressOut?: (event: any) => void;
    onLongPress?: (event: any) => void;
    onHoverIn?: (event: any) => void;
    onHoverOut?: (event: any) => void;
    delayLongPress?: number;
    style?:
      | StyleProp<Record<string, unknown>>
      | ((state: PressableStateCallback) => StyleProp<Record<string, unknown>>);
  }
  export const Pressable: ForwardRefExoticComponent<PressableProps & RefAttributes<HTMLElement>>;

  export interface ScrollViewProps extends ViewProps {
    horizontal?: boolean;
    contentContainerStyle?: StyleProp<Record<string, unknown>>;
    keyboardDismissMode?: 'none' | 'interactive' | 'on-drag';
    scrollEnabled?: boolean;
    stickyHeaderIndices?: number[];
  }
  export const ScrollView: ForwardRefExoticComponent<ScrollViewProps & RefAttributes<HTMLElement>>;

  export interface TextInputProps extends Omit<ViewProps, 'style'> {
    style?: StyleProp<Record<string, unknown>>;
    value?: string;
    defaultValue?: string;
    placeholder?: string;
    placeholderTextColor?: string;
    secureTextEntry?: boolean;
    multiline?: boolean;
    numberOfLines?: number;
    autoFocus?: boolean;
    autoCorrect?: boolean;
    autoCapitalize?: 'characters' | 'none' | 'sentences' | 'words';
    disabled?: boolean;
    editable?: boolean;
    maxLength?: number;
    onChange?: (event: any) => void;
    onChangeText?: (...args: any[]) => void;
    onSubmitEditing?: (event: any) => void;
    onKeyPress?: (event: any) => void;
    // React Native compat props RNW still accepts on web.
    keyboardType?:
      | 'default'
      | 'email-address'
      | 'number-pad'
      | 'numbers-and-punctuation'
      | 'numeric'
      | 'phone-pad'
      | 'search'
      | 'url'
      | 'web-search';
    returnKeyType?: 'enter' | 'done' | 'go' | 'next' | 'previous' | 'search' | 'send';
  }
  export const TextInput: ForwardRefExoticComponent<TextInputProps & RefAttributes<HTMLElement>>;

  export interface ModalProps {
    animationType?: 'none' | 'slide' | 'fade';
    children: ReactNode;
    onDismiss?: () => void;
    onRequestClose?: () => void;
    onShow?: () => void;
    transparent?: boolean;
    visible?: boolean;
  }
  export const Modal: ComponentType<ModalProps>;
}
