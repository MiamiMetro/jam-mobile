//import react navigation

//!!!Native Taba GEÇ
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";

//import screens
import ProfileScreen from "../screens/Profile/ProfileScreen";
import HomeScreen from "../screens/Home/HomeScreen";
import JamScreen from "../screens/Jams/JamScreen";
import MessagesScreen from "../screens/Messages/MessagesScreen";

const Tab = createBottomTabNavigator();

const MainTabs = () => {
    return (
        <Tab.Navigator>
            <Tab.Screen name="Home" component={HomeScreen} />
            <Tab.Screen name="Jams" component={JamScreen} />
            <Tab.Screen name="Messages" component={MessagesScreen} />
            <Tab.Screen name="Profile" component={ProfileScreen} />
        </Tab.Navigator>
    );
}

export default MainTabs;