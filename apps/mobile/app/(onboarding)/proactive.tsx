// M-ON-03: keeps its plan §9 path and opens the intro pager on its page.
import { Redirect } from 'expo-router';

export default function IntroPage() {
  return <Redirect href="/welcome?page=2" />;
}
