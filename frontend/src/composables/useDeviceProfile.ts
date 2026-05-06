import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

const mobileQuery = '(max-width: 900px)';

export function useDeviceProfile() {
  const isMobileLayout = ref(false);
  const platform = ref<'android' | 'ios' | 'harmony' | 'desktop'>('desktop');
  let mediaQuery: MediaQueryList | undefined;

  function updateLayout() {
    isMobileLayout.value = mediaQuery?.matches || false;
  }

  function updatePlatform() {
    const userAgent = navigator.userAgent.toLowerCase();
    if (/harmony|huawei|honor/.test(userAgent)) {
      platform.value = 'harmony';
      return;
    }
    if (/android/.test(userAgent)) {
      platform.value = 'android';
      return;
    }
    if (/iphone|ipad|ipod|macintosh/.test(userAgent) && navigator.maxTouchPoints > 1) {
      platform.value = 'ios';
      return;
    }
    platform.value = 'desktop';
  }

  onMounted(() => {
    mediaQuery = window.matchMedia(mobileQuery);
    updateLayout();
    updatePlatform();
    mediaQuery.addEventListener('change', updateLayout);
  });

  onBeforeUnmount(() => {
    mediaQuery?.removeEventListener('change', updateLayout);
  });

  const shellClass = computed(() => ({
    'mobile-layout': isMobileLayout.value,
    'desktop-layout': !isMobileLayout.value,
    [`platform-${platform.value}`]: true
  }));

  return {
    isMobileLayout,
    platform,
    shellClass
  };
}
