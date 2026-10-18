import importlib.util,pathlib,unittest,tempfile,hashlib,json
import torch
ROOT=pathlib.Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('moge_nodes',ROOT/'assets/moge-nodes/__init__.py');nodes=importlib.util.module_from_spec(spec);spec.loader.exec_module(nodes)
spec2=importlib.util.spec_from_file_location('downloader',ROOT/'assets/download_models.py');dl=importlib.util.module_from_spec(spec2);spec2.loader.exec_module(dl)
class InpaintTest(unittest.TestCase):
 def test_small_details_reduce_strength_without_limiting_larger_structural_repairs(self):
  small=torch.zeros(1,1024,1024);small[:,500:562,450:514]=1
  self.assertEqual(nodes.MogeDetailStrength().adapt(small,.6),(.45,))
  self.assertEqual(nodes.MogeDetailStrength().adapt(small,.3),(.3,))
  large=torch.zeros_like(small);large[:,700:833,745:905]=1
  self.assertEqual(nodes.MogeDetailStrength().adapt(large,.6),(.6,))
 def test_small_hand_selection_does_not_repaint_the_neighboring_hand(self):
  image=torch.zeros(1,160,180,3);mask=torch.zeros(1,160,180);mask[:,60:100,65:105]=1
  crop,noise,ctx=nodes.MogePrepareInpaint().prepare(image,mask,8,False,True,64,16,512,True)
  result,=nodes.MogeCompositeInpaint().composite(torch.ones_like(crop),ctx)
  self.assertTrue(torch.all(result[:,60:100,65:105]>.999))
  self.assertTrue(torch.all(result[:,:,110:]==0),'The adjacent hand must remain untouched')
 def test_large_pose_condition_clears_only_the_painted_old_pose(self):
  image=torch.rand(1,32,48,3);mask=torch.zeros(1,32,48);mask[:,10:20,12:30]=1
  result,=nodes.MogeInpaintCondition().prepare(image,mask)
  self.assertTrue(torch.all(result[mask==1]==0));self.assertTrue(torch.equal(result[mask==0],image[mask==0]))
 def test_expanded_transition_reaches_zero_without_a_half_alpha_seam(self):
  image=torch.zeros(1,96,128,3);mask=torch.zeros(1,96,128);mask[:,30:60,45:85]=1
  crop,noise,ctx=nodes.MogePrepareInpaint().prepare(image,mask,8,False,False,32,16,128)
  alpha=ctx['mask'][0]
  self.assertEqual(alpha[45,29].item(),0)
  self.assertGreater(alpha[45,30].item(),0);self.assertLess(alpha[45,30].item(),.05)
  self.assertEqual(alpha[45,44].item(),1)
 def test_composite_preserves_unmasked_pixels_and_native_dimensions(self):
  image=torch.rand(1,117,203,3);mask=torch.zeros(1,117,203);mask[:,30:70,70:120]=1
  crop,noise,ctx=nodes.MogePrepareInpaint().prepare(image,mask,0,False,True,16,0,512)
  self.assertEqual(crop.shape[1]%16,0);self.assertEqual(crop.shape[2]%16,0)
  result,=nodes.MogeCompositeInpaint().composite(torch.ones_like(crop),ctx)
  self.assertEqual(tuple(result.shape),tuple(image.shape));self.assertTrue(torch.equal(result[mask==0],image[mask==0]));self.assertTrue(torch.all(result[mask==1]>.999))
 def test_blurred_feather_also_preserves_all_unpainted_pixels(self):
  image=torch.rand(1,96,128,3);mask=torch.zeros(1,96,128);mask[:,30:60,45:85]=1
  crop,noise,ctx=nodes.MogePrepareInpaint().prepare(image,mask,6,False,True,20,0,512)
  result,=nodes.MogeCompositeInpaint().composite(torch.ones_like(crop),ctx)
  self.assertTrue(torch.equal(result[mask==0],image[mask==0]))
 def test_empty_mask_is_rejected(self):
  with self.assertRaisesRegex(ValueError,'遮罩'):nodes.MogePrepareInpaint().prepare(torch.zeros(1,64,64,3),torch.zeros(1,64,64),4,False,False,32,0,512)
 def test_expansion_feathers_outside_core_without_restoring_old_outline(self):
  image=torch.zeros(1,96,128,3);image[:,:,:,0]=1;mask=torch.zeros(1,96,128);mask[:,30:60,45:85]=1
  crop,noise,ctx=nodes.MogePrepareInpaint().prepare(image,mask,2,False,True,20,4,512)
  replacement=torch.zeros_like(crop);replacement[:,:,:,2]=1
  result,=nodes.MogeCompositeInpaint().composite(replacement,ctx)
  self.assertTrue(torch.all(result[mask==1][:,0]==0),'Old red outline must not bleed into the painted core')
  self.assertTrue(torch.all(result[mask==1][:,2]>.999))
  solid=torch.nn.functional.max_pool2d(mask.unsqueeze(1),5,stride=1,padding=2).squeeze(1)
  self.assertTrue(torch.all(result[solid==1][:,0]==0),'Antialiased outlines just beyond the core also need full replacement')
  expanded=torch.nn.functional.max_pool2d(mask.unsqueeze(1),9,stride=1,padding=4).squeeze(1)
  self.assertTrue(torch.equal(result[expanded==0],image[expanded==0]))
  self.assertTrue(torch.any((ctx['mask']>0)&(ctx['mask']<1)&(mask==0)))
 def test_integrity_detects_same_size_corruption(self):
  with tempfile.TemporaryDirectory(prefix='moge-integrity-') as directory:
   root=pathlib.Path(directory);(root/'model.safetensors').write_bytes(b'correct');items=[{'target':'model.safetensors','size':7,'sha256':hashlib.sha256(b'correct').hexdigest()}]
   self.assertEqual(dl.check(items,root,True)[0]['state'],'verified');(root/'model.safetensors').write_bytes(b'corrupt');self.assertEqual(dl.check(items,root,True)[0]['state'],'invalid');(root/'model.safetensors').unlink();self.assertEqual(dl.check(items,root)[0]['state'],'missing')
if __name__=='__main__':unittest.main()
