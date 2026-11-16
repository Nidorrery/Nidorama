package app.nidorama.controller;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NidoramaPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
