package pe.agrovision.supervisioncosecha;

import android.Manifest;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Window;
import androidx.core.app.ActivityCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    ActivityCompat.requestPermissions(
      this,
      new String[] { Manifest.permission.CAMERA },
      1001
    );

    Window window = getWindow();
    WindowCompat.setDecorFitsSystemWindows(window, true);
    window.setNavigationBarColor(Color.WHITE);
    window.setStatusBarColor(Color.parseColor("#5ead51"));
    WindowInsetsControllerCompat bars =
      WindowCompat.getInsetsController(window, window.getDecorView());
    if (bars != null) {
      bars.setAppearanceLightNavigationBars(true);
      bars.setAppearanceLightStatusBars(false);
    }
  }
}
