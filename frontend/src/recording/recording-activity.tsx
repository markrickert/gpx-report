import { HStack, Image, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import {
  font,
  foregroundStyle,
  frame,
  monospacedDigit,
  multilineTextAlignment,
  padding,
} from "@expo/ui/swift-ui/modifiers";
import { createLiveActivity } from "expo-widgets";

type RecordingActivityProps = {
  paused: boolean;
  /** Wall-clock time in ms that the running timer counts up from. */
  timerStart: number;
  /** Shown in place of the timer while paused. */
  duration: string;
  distance: string;
};

// Runs in the widget extension, not in the app: it can use only its props and
// what it declares inside the function.
const RecordingActivity = (props: RecordingActivityProps) => {
  "widget";
  const color = props.paused ? "#d97706" : "#dc2626";
  const icon = props.paused ? "pause.circle.fill" : "record.circle";
  const secondary = foregroundStyle({ type: "hierarchical", style: "secondary" });
  // A timer text takes all the width it is offered, so the Dynamic Island
  // needs a limit.
  const timer = (size: number, maxWidth?: number) => {
    const modifiers = [
      font({ size, weight: "semibold" }),
      monospacedDigit(),
      ...(maxWidth ? [frame({ maxWidth }), multilineTextAlignment("trailing")] : []),
    ];
    return props.paused ? (
      <Text modifiers={modifiers}>{props.duration}</Text>
    ) : (
      <Text date={new Date(props.timerStart)} dateStyle="timer" modifiers={modifiers} />
    );
  };
  const state = (
    <HStack spacing={4}>
      <Image systemName={icon} color={color} size={14} />
      <Text modifiers={[font({ size: 13 }), secondary]}>
        {props.paused ? "Paused" : "Recording"}
      </Text>
    </HStack>
  );
  const distance = (
    <VStack alignment="trailing">
      <Text modifiers={[font({ size: 13 }), secondary]}>Distance</Text>
      <Text modifiers={[font({ size: 28, weight: "semibold" }), monospacedDigit()]}>
        {props.distance}
      </Text>
    </VStack>
  );

  return {
    banner: (
      <HStack modifiers={[padding({ all: 16 })]}>
        <VStack alignment="leading">
          {state}
          {timer(28)}
        </VStack>
        <Spacer />
        {distance}
      </HStack>
    ),
    compactLeading: <Image systemName={icon} color={color} />,
    compactTrailing: timer(14, 56),
    minimal: <Image systemName={icon} color={color} />,
    expandedLeading: (
      <VStack alignment="leading" modifiers={[padding({ leading: 8 })]}>
        {state}
        {timer(28)}
      </VStack>
    ),
    expandedTrailing: <VStack modifiers={[padding({ trailing: 8 })]}>{distance}</VStack>,
  };
};

export default createLiveActivity("RecordingActivity", RecordingActivity);
