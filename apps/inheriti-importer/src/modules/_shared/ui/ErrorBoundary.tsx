import { Component, type ErrorInfo, type ReactNode } from 'react';
import { secureCleanup } from '@shared/application/secure-cleanup-controller';
import { Box, Text } from '@modules/_shared/ui/components';
import Button from '@modules/_shared/ui/components/Base/Button';

interface Props {
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches render/lifecycle errors. On failure it runs the secure-cleanup tasks
 * so a crash never leaves imported secrets sitting in memory, and shows a
 * message with NO error payload (which could contain a secret).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo): void {
    void secureCleanup.runAll();
  }

  #reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(this.state.error, this.#reset);

    return (
      <Box
        flex={1}
        justifyContent="center"
        alignItems="center"
        padding="l"
        accessibilityRole="alert"
      >
        <Box
          gap="m"
          maxWidth={440}
          width="100%"
          padding="l"
          backgroundColor="white"
          borderRadius="s"
        >
          <Text variant="heading3">Something went wrong</Text>
          <Text variant="bodySmall">
            The import was stopped and any loaded secrets were cleared.
          </Text>
          <Button title="Start over" onPress={this.#reset} />
        </Box>
      </Box>
    );
  }
}
