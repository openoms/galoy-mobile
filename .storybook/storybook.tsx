import React from "react"
import { getStorybookUI } from "@storybook/react-native"

import { NavigationContainer } from "@react-navigation/native"
import { ThemeProvider } from "@rneui/themed"
import { createStackNavigator } from "@react-navigation/stack"
import theme from "@app/rne-theme/theme"
import TypesafeI18n from "@app/i18n/i18n-react"

// import './doctools'

// storybook.requires.js auto generated by storybook
// eslint-disable-next-line import/no-unresolved
import "./storybook.requires"
import { detectDefaultLocale } from "../app/utils/locale-detector"
import RNBootSplash from "react-native-bootsplash"
import { GestureHandlerRootView } from "react-native-gesture-handler"
import { NotificationsProvider } from "../app/components/notifications"

RNBootSplash.hide({ fade: true })

const StorybookUI = getStorybookUI({
  enableWebsockets: true, // for @storybook/react-native-server
  onDeviceUI: true,
  initialSelection: { kind: "Notification Card UI", name: "Default" },
  shouldPersistSelection: false,
})

const Stack = createStackNavigator()

const ThemeWrapper: React.FC<React.PropsWithChildren> = ({ children }) => (
  <ThemeProvider theme={theme}>{children}</ThemeProvider>
)

const I18nWrapper: React.FC<React.PropsWithChildren> = ({ children }) => (
  <TypesafeI18n locale={detectDefaultLocale()}>{children}</TypesafeI18n>
)

export const StorybookUIRoot: React.FC = () => (
  <GestureHandlerRootView style={{ flex: 1 }}>
    <I18nWrapper>
      <ThemeWrapper>
        <NotificationsProvider>
          <NavigationContainer>
            <Stack.Navigator>
              <Stack.Screen
                name="Home"
                options={{
                  headerShown: false,
                  animationEnabled: false,
                }}
                component={StorybookUI}
              />
            </Stack.Navigator>
          </NavigationContainer>
        </NotificationsProvider>
      </ThemeWrapper>
    </I18nWrapper>
  </GestureHandlerRootView>
)
