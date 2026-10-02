import { Component, type ErrorInfo, type ReactNode } from 'react';
import { View } from 'react-native';

import { Button } from '@/core/presentation/components/ui/button';
import { Text } from '@/core/presentation/components/ui/text';

type Props = {
  children: ReactNode;
  /** Called when the start failed, so the native splash screen does not stay over the message. */
  onFailure?: () => void;
};
type State = { hasFailed: boolean; attempt: number };

/**
 * Catches a failure to open or prepare the local database, or any other error
 * while the app starts, and says so in plain words instead of leaving a blank
 * or technical screen. The stored data is not touched; "Try again" starts the
 * app's content over. The technical detail goes to the console only.
 */
export class StartupErrorBoundary extends Component<Props, State> {
  state: State = { hasFailed: false, attempt: 0 };

  static getDerivedStateFromError(): Partial<State> {
    return { hasFailed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
    this.props.onFailure?.();
  }

  render() {
    if (!this.state.hasFailed) {
      // A new key after "Try again" mounts everything below from scratch.
      return <View key={this.state.attempt} className="flex-1">{this.props.children}</View>;
    }
    return (
      <View className="flex-1 items-center justify-center gap-4 bg-background p-6">
        <View accessible accessibilityRole="alert" className="gap-2">
          <Text role="heading" aria-level="1" className="text-center text-xl font-semibold leading-7">
            Answer Checker could not start
          </Text>
          <Text className="text-center text-[15px] leading-[22px] text-muted-foreground">
            The data stored on this phone could not be opened. Nothing was deleted. Try again; if it
            keeps happening, restart the phone.
          </Text>
        </View>
        <Button
          className="h-12"
          onPress={() => this.setState((state) => ({ hasFailed: false, attempt: state.attempt + 1 }))}>
          <Text>Try again</Text>
        </Button>
      </View>
    );
  }
}
