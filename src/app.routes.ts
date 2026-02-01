import { Routes } from '@angular/router';
import { HomeComponent } from './pages/home.component';
import { MediaComponent } from './pages/media.component';
import { MediaDetailComponent } from './pages/media-detail.component';
import { AppsComponent } from './pages/apps.component';
import { RecycleBinComponent } from './pages/recycle-bin.component';
import { WorkflowComponent } from './pages/workflow.component';

export const routes: Routes = [
  { path: '', component: HomeComponent },
  { path: 'workflow', component: WorkflowComponent },
  { path: 'media', component: MediaComponent },
  { path: 'media/:id', component: MediaDetailComponent },  // 媒体详情页（包含笔记/书签/转写等Tab）
  { path: 'apps', component: AppsComponent },
  { path: 'recycle-bin', component: RecycleBinComponent },
  { path: '**', redirectTo: '' }
];